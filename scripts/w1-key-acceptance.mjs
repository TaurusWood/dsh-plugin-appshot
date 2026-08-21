
const { spawn } = await import('node:child_process')
const { writeFileSync } = await import('node:fs')

// 1. 启动 exe（allow-injected + 测试 staging）
const staging = process.env.TEMP + '\\dsh-appshot-keytest'
const child = spawn('W:\\dev\\dsh-plugin-appshot\\native\\windows\\bin\\win-x64\\appshot-win-x64.exe', [
  '--mode', 'daemon', '--staging-dir', staging, '--dsh-pid', '99999', '--allow-injected'
], { stdio: ['pipe', 'pipe', 'pipe'] })
let out = ''
let err = ''
child.stdout.on('data', d => { out += d.toString() })
child.stderr.on('data', d => { err += d.toString() })

await new Promise(r => setTimeout(r, 2000))
console.log('READY line:', JSON.stringify(out.trim()))

// 2. 用 PowerShell Add-Type SendInput 模拟：左 Ctrl down → 100ms → 右 Ctrl down → 100ms → 释放
const psScript = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class KeySim {
  [StructLayout(LayoutKind.Sequential)] public struct INPUT {
    public uint type;
    public InputUnion U;
  }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion {
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  public const uint INPUT_KEYBOARD = 1;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public static void KeyDown(ushort vk) { Send(0, vk); }
  public static void KeyUp(ushort vk) { Send(KEYEVENTF_KEYUP, vk); }
  static void Send(uint flags, ushort vk) {
    var inp = new INPUT { type = INPUT_KEYBOARD, U = new InputUnion { ki = new KEYBDINPUT { wVk = vk, dwFlags = flags } } };
    SendInput(1, new[] { inp }, Marshal.SizeOf(typeof(INPUT)));
  }
}
'@
[KeySim]::KeyDown(0xA2)   # LCTRL down
Start-Sleep -Milliseconds 100
[KeySim]::KeyDown(0xA3)   # RCTRL down
Start-Sleep -Milliseconds 150
[KeySim]::KeyUp(0xA2)     # LCTRL up
[KeySim]::KeyUp(0xA3)     # RCTRL up
Write-Host "keys sent"
`
const { execSync } = await import('node:child_process')
const psOut = execSync('powershell -NoProfile -Command ' + JSON.stringify(psScript), { encoding: 'utf8' })
console.log('PS:', psOut.trim())

// 3. 等待 exe 处理并输出帧
await new Promise(r => setTimeout(r, 1500))
console.log('STDOUT frames:')
console.log(out.trim())

child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n')
await new Promise(r => setTimeout(r, 1500))
console.log('exited:', child.exitCode !== null)
if (child.exitCode === null) { child.kill(); console.log('force-killed') }
