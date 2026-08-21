Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class KeySim3 {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public static void Down(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); }
  public static void Up(byte vk) { keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); }
}
"@
[KeySim3]::Down(0xA2)
Start-Sleep -Milliseconds 150
[KeySim3]::Down(0xA3)
Start-Sleep -Milliseconds 200
[KeySim3]::Up(0xA2)
[KeySim3]::Up(0xA3)
Write-Host "keybd_event sent"