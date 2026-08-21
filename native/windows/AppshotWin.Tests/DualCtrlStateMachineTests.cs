using Xunit;
using AppshotWin.Hotkey;

namespace AppshotWin.Tests;

public class DualCtrlStateMachineTests
{
    private static DualCtrlStateMachine Create(Func<long> clock) =>
        new(combinationWindowMs: 300, cooldownMs: 500, clockMs: clock);

    /// <summary>可控时钟。</summary>
    private sealed class FakeClock
    {
        private long _now;
        public long Now => _now;
        public void Advance(long ms) => _now += ms;
        public Func<long> Get() => () => _now;
    }

    [Fact]
    public void SingleCtrlDoesNotTrigger()
    {
        var clock = new FakeClock();
        var sm = Create(clock.Get());
        Assert.False(sm.OnKeyDown(DualCtrlStateMachine.VK_LCONTROL));
        Assert.True(sm.IsLeftDown);
        Assert.False(sm.IsRightDown);
        Assert.False(sm.InFlight);
    }

    [Fact]
    public void BothCtrlsWithinWindowTriggerOnce()
    {
        var clock = new FakeClock();
        var sm = Create(clock.Get());

        Assert.False(sm.OnKeyDown(DualCtrlStateMachine.VK_LCONTROL)); // t=0
        clock.Advance(100);
        Assert.True(sm.OnKeyDown(DualCtrlStateMachine.VK_RCONTROL));  // t=100 ≤ 300ms 组合窗
        Assert.True(sm.InFlight);

        // 触发后仍按下不重复触发
        clock.Advance(50);
        Assert.False(sm.OnKeyDown(DualCtrlStateMachine.VK_LCONTROL));
        Assert.False(sm.OnKeyDown(DualCtrlStateMachine.VK_RCONTROL));
    }

    [Fact]
    public void ReleaseBothKeysResetsInFlight()
    {
        var clock = new FakeClock();
        var sm = Create(clock.Get());
        sm.OnKeyDown(DualCtrlStateMachine.VK_LCONTROL);
        clock.Advance(100);
        sm.OnKeyDown(DualCtrlStateMachine.VK_RCONTROL);

        // 只释放左键：inFlight 保持
        sm.OnKeyUp(DualCtrlStateMachine.VK_LCONTROL);
        Assert.True(sm.InFlight);
        // 释放右键：完全释放后解除
        sm.OnKeyUp(DualCtrlStateMachine.VK_RCONTROL);
        Assert.False(sm.InFlight);
    }

    [Fact]
    public void CooldownBlocksRapidRetrigger()
    {
        var clock = new FakeClock();
        var sm = Create(clock.Get());

        // 第一次触发
        sm.OnKeyDown(DualCtrlStateMachine.VK_LCONTROL);
        clock.Advance(100);
        sm.OnKeyDown(DualCtrlStateMachine.VK_RCONTROL);
        sm.OnKeyUp(DualCtrlStateMachine.VK_LCONTROL);
        sm.OnKeyUp(DualCtrlStateMachine.VK_RCONTROL);
        Assert.False(sm.InFlight);

        // 200ms 后重新按下（< 500ms 冷却）
        clock.Advance(200);
        Assert.False(sm.OnKeyDown(DualCtrlStateMachine.VK_LCONTROL));
        Assert.False(sm.OnKeyDown(DualCtrlStateMachine.VK_RCONTROL));
    }

    [Fact]
    public void RepeatPulsesAreFiltered()
    {
        var clock = new FakeClock();
        var sm = Create(clock.Get());

        // 长按左 Ctrl 产生的 repeat 脉冲：同键已按下则忽略
        Assert.False(sm.OnKeyDown(DualCtrlStateMachine.VK_LCONTROL));
        clock.Advance(50);
        Assert.False(sm.OnKeyDown(DualCtrlStateMachine.VK_LCONTROL));
        clock.Advance(50);
        Assert.False(sm.OnKeyDown(DualCtrlStateMachine.VK_LCONTROL));
        Assert.True(sm.IsLeftDown);
        Assert.False(sm.InFlight);
    }

    [Fact]
    public void BeyondCombinationWindowDoesNotTrigger()
    {
        var clock = new FakeClock();
        var sm = Create(clock.Get());

        sm.OnKeyDown(DualCtrlStateMachine.VK_LCONTROL);
        clock.Advance(400); // > 300ms 组合窗
        Assert.False(sm.OnKeyDown(DualCtrlStateMachine.VK_RCONTROL));
        Assert.False(sm.InFlight);
    }

    [Fact]
    public void RetriggerAfterCooldownAndFullReleaseWorks()
    {
        var clock = new FakeClock();
        var sm = Create(clock.Get());

        // 第一次触发并完全释放
        sm.OnKeyDown(DualCtrlStateMachine.VK_LCONTROL);
        clock.Advance(100);
        sm.OnKeyDown(DualCtrlStateMachine.VK_RCONTROL);
        sm.OnKeyUp(DualCtrlStateMachine.VK_LCONTROL);
        sm.OnKeyUp(DualCtrlStateMachine.VK_RCONTROL);

        // 600ms 后重新按下（> 500ms 冷却）
        clock.Advance(600);
        Assert.False(sm.OnKeyDown(DualCtrlStateMachine.VK_LCONTROL));
        clock.Advance(100);
        Assert.True(sm.OnKeyDown(DualCtrlStateMachine.VK_RCONTROL));
    }
}
