using System;
using System.Diagnostics;
using System.ServiceProcess;
using System.Threading;

// Only the SCM wrapper runs as SYSTEM. Account operations run in the owner's
// non-elevated interactive scheduled task; no user-writable code runs as SYSTEM.
public sealed class BiuukaService : ServiceBase {
    const string Task = "__TASK__";
    static void TaskCommand(string action) {
        var p = new Process();
        p.StartInfo = new ProcessStartInfo(Environment.GetFolderPath(Environment.SpecialFolder.System) + "\\schtasks.exe", action + " /tn \"" + Task + "\"");
        p.StartInfo.UseShellExecute = false; p.StartInfo.CreateNoWindow = true;
        p.StartInfo.RedirectStandardOutput = true; p.StartInfo.RedirectStandardError = true;
        p.Start(); p.BeginOutputReadLine(); p.BeginErrorReadLine();
        if (!p.WaitForExit(10000)) p.Kill(); p.Dispose();
    }
    public BiuukaService() { ServiceName = "Biuuka"; CanStop = true; CanShutdown = true; AutoLog = false; }
    protected override void OnStart(string[] args) { TaskCommand("/run"); }
    protected override void OnStop() { Thread.Sleep(2500); TaskCommand("/end"); }
    protected override void OnShutdown() { OnStop(); }
    public static int Main(string[] args) {
        if (args.Length == 1 && (args[0] == "--helper" || args[0] == "--tray")) {
            var p = new Process();
            var shell = Environment.GetFolderPath(Environment.SpecialFolder.System) + "\\WindowsPowerShell\\v1.0\\powershell.exe";
            p.StartInfo = new ProcessStartInfo(shell, "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + AppDomain.CurrentDomain.BaseDirectory + "run.ps1\"" + (args[0] == "--tray" ? " -Tray" : ""));
            p.StartInfo.UseShellExecute = false; p.StartInfo.CreateNoWindow = true;
            p.Start(); p.WaitForExit(); return p.ExitCode;
        }
        ServiceBase.Run(new BiuukaService()); return 0;
    }
}
