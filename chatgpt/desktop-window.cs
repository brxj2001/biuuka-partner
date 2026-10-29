using System;
using System.Runtime.InteropServices;
// Only the verified launch PID is accepted. No global settings or synthetic input.
public static class BiuukaDesktopWindow {
 delegate bool WindowCallback(IntPtr hwnd, IntPtr state);
 [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback, IntPtr state);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
 [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint command);
 [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hwnd);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
 [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hwnd, int command);
 [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
 [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
 public static IntPtr Find(uint pid) {
  IntPtr found=IntPtr.Zero;
  EnumWindows(delegate(IntPtr hwnd,IntPtr state) {
   uint owner; GetWindowThreadProcessId(hwnd,out owner);
   if(owner==pid && GetWindow(hwnd,4)==IntPtr.Zero && GetWindowTextLength(hwnd)>0) {found=hwnd;return false;}
   return true;
  },IntPtr.Zero);
  return found;
 }
 public static string Present(uint pid, IntPtr hwnd) {
  uint owner; GetWindowThreadProcessId(hwnd,out owner);
  if(hwnd==IntPtr.Zero || owner!=pid)return "pending";
  if(IsIconic(hwnd))ShowWindowAsync(hwnd,9);else if(!IsWindowVisible(hwnd))ShowWindowAsync(hwnd,5);
  SetForegroundWindow(hwnd);
  if(GetForegroundWindow()!=hwnd) {
   uint ignored; uint foreground=GetWindowThreadProcessId(GetForegroundWindow(),out ignored);
   uint current=GetCurrentThreadId(); bool attached=false;
   try {if(foreground!=0 && foreground!=current)attached=AttachThreadInput(current,foreground,true);SetForegroundWindow(hwnd);}
   finally {if(attached)AttachThreadInput(current,foreground,false);}
  }
  if(!IsWindowVisible(hwnd) || IsIconic(hwnd))return "pending";
  return GetForegroundWindow()==hwnd ? "foreground" : "background";
 }
}
