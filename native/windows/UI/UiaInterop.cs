using System;
using System.Runtime.InteropServices;

namespace AppshotWin.UI;

/// <summary>
/// UI Automation 客户端 COM 接口的精简 interop。
///
/// 用途：替代 System.Windows.Automation（托管 UIA），后者属于 WindowsDesktop 框架引用，
/// 会把整个 WPF 运行时打进自包含单文件（约 +50MB）。任务栏定位只需要 3 个调用：
/// ElementFromHandle / CreateTrueCondition / FindAll + Name / BoundingRectangle 属性。
///
/// 正确性约束：接口 GUID 与方法槽位顺序按 Windows SDK UIAutomationClient.idl
/// (10.0.10240) 核对，并对照 HKCR\Interface 注册表验证。ComImport 接口的 vtable
/// 槽位由声明顺序决定，禁止增删或重排——错位会在运行时跳到错误的方法导致崩溃。
/// 只有标注"使用"的方法经过逐参数核对；其余仅为占位，签名未逐一对齐 IDL ABI
/// （如 POINT 按值参数、BuildCache 系列的参数顺序），不得直接调用，
/// 需要时先对照 UIAutomationClient.idl 补齐签名。
/// </summary>
internal static class UiaInterop
{
    /// <summary>TreeScope 枚举的 Descendants 值（UIAutomationClient.idl）。</summary>
    internal const int TreeScopeDescendants = 0x4;
}

/// <summary>UIA 坐标矩形：物理屏幕坐标，四个分量均为 double（UIA 体系无整型 RECT）。
/// 布局为 left/top/width/height（UIAutomationCore.h 的 UiaRect），不是 left/top/right/bottom。</summary>
[StructLayout(LayoutKind.Sequential)]
internal struct UiaRect
{
    public double Left;
    public double Top;
    public double Width;
    public double Height;
}

[ComImport]
[Guid("352ffba8-0973-437c-a61f-f64cafd81df9")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IUIAutomationCondition
{
    // 无方法：仅作为条件对象的类型载体，FindAll 入参按声明的 IID 传回 native。
}

[ComImport]
[Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IUIAutomation
{
    void CompareElements(IntPtr el1, IntPtr el2, out IntPtr areSame);                                   // 1
    void CompareRuntimeIds(IntPtr runtimeId1, IntPtr runtimeId2, out IntPtr areSame);                   // 2
    void GetRootElement(out IntPtr root);                                                                // 3
    void ElementFromHandle(IntPtr hwnd, out IUIAutomationElement element);                               // 4 使用
    void ElementFromPoint(int ptX, int ptY, out IntPtr element);                                         // 5
    void GetFocusedElement(out IntPtr element);                                                          // 6
    void GetRootElementBuildCache(IntPtr cacheRequest, out IntPtr root);                                 // 7
    void ElementFromHandleBuildCache(IntPtr hwnd, IntPtr cacheRequest, out IntPtr element);              // 8
    void ElementFromPointBuildCache(int ptX, int ptY, IntPtr cacheRequest, out IntPtr element);          // 9
    void GetFocusedElementBuildCache(IntPtr cacheRequest, out IntPtr element);                           // 10
    void CreateTreeWalker(IntPtr condition, out IntPtr walker);                                          // 11
    void GetControlViewWalker(out IntPtr walker);                                                        // 12
    void GetContentViewWalker(out IntPtr walker);                                                        // 13
    void GetRawViewWalker(out IntPtr walker);                                                            // 14
    void GetRawViewCondition(out IntPtr condition);                                                      // 15
    void GetControlViewCondition(out IntPtr condition);                                                  // 16
    void GetContentViewCondition(out IntPtr condition);                                                  // 17
    void CreateCacheRequest(out IntPtr cacheRequest);                                                    // 18
    void CreateTrueCondition(out IUIAutomationCondition newCondition);                                   // 19 使用
}

[ComImport]
[Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IUIAutomationElement
{
    void SetFocus();                                                                                     // 1
    void GetRuntimeId(out IntPtr runtimeId);                                                             // 2
    void FindFirst(int scope, IUIAutomationCondition condition, out IntPtr found);                       // 3
    void FindAll(int scope, IUIAutomationCondition condition, out IUIAutomationElementArray found);      // 4 使用
    void FindFirstBuildCache(int scope, IUIAutomationCondition condition, IntPtr cacheRequest, out IntPtr found);        // 5
    void FindAllBuildCache(int scope, IUIAutomationCondition condition, IntPtr cacheRequest, out IntPtr found);          // 6
    void BuildUpdatedCache(IntPtr cacheRequest, out IntPtr updatedElement);                              // 7
    void GetCurrentPropertyValue(int propertyId, out IntPtr retVal);                                     // 8
    void GetCurrentPropertyValueEx(int propertyId, int ignoreDefaultValue, out IntPtr retVal);           // 9
    void GetCachedPropertyValue(int propertyId, out IntPtr retVal);                                      // 10
    void GetCachedPropertyValueEx(int propertyId, int ignoreDefaultValue, out IntPtr retVal);            // 11
    void GetCurrentPatternAs(int patternId, ref Guid riid, out IntPtr patternInterface);                 // 12
    void GetCachedPatternAs(int patternId, ref Guid riid, out IntPtr patternInterface);                  // 13
    void GetCurrentPattern(int patternId, out IntPtr patternObject);                                     // 14
    void GetCachedPattern(int patternId, out IntPtr patternObject);                                      // 15
    void GetCachedParent(out IntPtr parent);                                                             // 16
    void GetCachedChildren(out IntPtr children);                                                         // 17
    void CurrentProcessId(out int retVal);                                                               // 18
    void CurrentControlType(out int retVal);                                                             // 19
    void CurrentLocalizedControlType(IntPtr retVal);                                                     // 20
    void CurrentName([MarshalAs(UnmanagedType.BStr)] out string retVal);                                 // 21 使用
    void CurrentAcceleratorKey(IntPtr retVal);                                                           // 22
    void CurrentAccessKey(IntPtr retVal);                                                                // 23
    void CurrentHasKeyboardFocus(IntPtr retVal);                                                         // 24
    void CurrentIsKeyboardFocusable(IntPtr retVal);                                                      // 25
    void CurrentIsEnabled(IntPtr retVal);                                                                // 26
    void CurrentAutomationId(IntPtr retVal);                                                             // 27
    void CurrentClassName(IntPtr retVal);                                                                // 28
    void CurrentHelpText(IntPtr retVal);                                                                 // 29
    void CurrentCulture(IntPtr retVal);                                                                  // 30
    void CurrentIsControlElement(IntPtr retVal);                                                         // 31
    void CurrentIsContentElement(IntPtr retVal);                                                         // 32
    void CurrentIsPassword(IntPtr retVal);                                                               // 33
    void CurrentNativeWindowHandle(IntPtr retVal);                                                       // 34
    void CurrentItemType(IntPtr retVal);                                                                 // 35
    void CurrentIsOffscreen(IntPtr retVal);                                                              // 36
    void CurrentOrientation(IntPtr retVal);                                                              // 37
    void CurrentFrameworkId(IntPtr retVal);                                                              // 38
    void CurrentIsRequiredForForm(IntPtr retVal);                                                        // 39
    void CurrentItemStatus(IntPtr retVal);                                                               // 40
    void CurrentBoundingRectangle(out UiaRect retVal);                                                   // 41 使用
}

[ComImport]
[Guid("14314595-b4bc-4055-95f2-58f2e42c9855")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IUIAutomationElementArray
{
    void Length(out int length);                                                                          // 1 使用
    void GetElement(int index, out IUIAutomationElement element);                                         // 2 使用
}

/// <summary>CUIAutomation coclass（UIAutomationCore.dll 进程内组件）。</summary>
[ComImport]
[Guid("ff48dba4-60ef-4201-aa87-54103eef594e")]
internal class CUIAutomation
{
}
