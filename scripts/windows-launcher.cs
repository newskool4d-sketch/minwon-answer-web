using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    internal const string AppTitle = "민원답변 도우미";
    private const string PayloadResource = "MinwonPayload.zip";
    private const string VersionResource = "MinwonVersion.txt";
    private const string BuildResource = "MinwonBuild.txt";
    private const string MutexName = @"Local\MinwonAnswerApp";
    private const string InstallMutexName = @"Local\MinwonAnswerInstall";
    private const string ActivateEventName = @"Local\MinwonAnswerAppActivate";
    private const string ExecutableName = "MinwonAnswer.exe";
    // WebView2 SDK files shipped next to the installed executable (see build-windows-exe.ps1 for pinned hashes).
    internal static readonly string[] WebViewFiles = { "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll" };

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length >= 1 && (args[0] == "--self-test" || args[0] == "--webview-probe"))
        {
            UseUtf8StandardStreams();
            try { return args[0] == "--self-test" ? SelfTest() : WebViewProbe.Run(args.Length == 2 ? args[1] : String.Empty); }
            catch (Exception error)
            {
                Console.Error.WriteLine("SELF_TEST_FAIL " + error.Message);
                return 1;
            }
        }

        SetProcessDPIAware();
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try { return RunApp(); }
        catch (Exception error)
        {
            ShowError("민원답변 도우미를 시작하지 못했습니다.\n\n" + error.Message + "\n\n문제가 계속되면 프로그램을 다시 실행해 주세요.");
            return 1;
        }
    }

    private static int RunApp()
    {
        string version = ReadEmbeddedVersion();
        string build = ReadEmbeddedBuild();
        int port = ResolvePort();
        string url = "http://127.0.0.1:" + port.ToString();
        string selfPath = Assembly.GetExecutingAssembly().Location;
        string selfDirectory = Path.GetDirectoryName(selfPath);

        // The downloaded EXE only installs; the installed copy (with the WebView2 DLLs beside it) runs the app.
        if (!String.Equals(Path.GetFileName(selfPath), ExecutableName, StringComparison.OrdinalIgnoreCase) || !IsCompleteInstall(selfDirectory, version, build))
            return InstallAndRelaunch(version, build);

        bool ownsMutex;
        using (Mutex mutex = new Mutex(true, MutexName, out ownsMutex))
        {
            if (!ownsMutex)
            {
                // The previous instance may have released the lock without closing its handle yet.
                try { ownsMutex = mutex.WaitOne(0); }
                catch (AbandonedMutexException) { ownsMutex = true; }
            }
            if (!ownsMutex)
            {
                ActivateRunningInstance(url);
                return 0;
            }
            try
            {
                // Created right after taking the lock so a second launch during startup finds it and does not open a browser.
                using (EventWaitHandle activate = new EventWaitHandle(false, EventResetMode.AutoReset, ActivateEventName))
                {
                    return RunOwnedApp(version, port, url, selfDirectory, activate);
                }
            }
            finally { mutex.ReleaseMutex(); }
        }
    }

    private static int InstallAndRelaunch(string version, string build)
    {
        string programRoot = Path.Combine(LocalAppData(), "Programs", "minwon-answer");
        string installRoot = Path.Combine(programRoot, version);
        using (Mutex installMutex = new Mutex(false, InstallMutexName))
        {
            bool locked;
            try { locked = installMutex.WaitOne(TimeSpan.FromMinutes(2)); }
            catch (AbandonedMutexException) { locked = true; }
            if (!locked) throw new TimeoutException("다른 설치 작업이 끝나지 않았습니다. 잠시 후 다시 실행해 주세요.");
            try
            {
                // A different build of the same version (a rebuild or re-release) goes to its own folder; nothing is deleted.
                if (Directory.Exists(installRoot) && !IsCompleteInstall(installRoot, version, build))
                    installRoot = Path.Combine(programRoot, version + "-" + build.Substring(0, 8));
                EnsureInstalled(installRoot, version, build);
            }
            finally { installMutex.ReleaseMutex(); }
        }

        string installed = Path.Combine(installRoot, ExecutableName);
        CreateStartMenuShortcut(installed, installRoot);
        ProcessStartInfo start = new ProcessStartInfo(installed);
        start.WorkingDirectory = installRoot;
        start.UseShellExecute = false;
        using (Process process = Process.Start(start))
        {
            if (process == null) throw new InvalidOperationException("설치한 프로그램을 시작하지 못했습니다: " + installed);
        }
        return 0;
    }

    private static void ActivateRunningInstance(string url)
    {
        for (int attempt = 0; attempt < 20; attempt++)
        {
            EventWaitHandle activate;
            if (EventWaitHandle.TryOpenExisting(ActivateEventName, out activate))
            {
                using (activate)
                {
                    AllowSetForegroundWindow(-1);
                    activate.Set();
                }
                return;
            }
            Thread.Sleep(250);
        }
        // No activation signal for 5 seconds: an older version (0.4.x console launcher) holds the lock and serves this address.
        OpenBrowser(url);
    }

    private static int RunOwnedApp(string version, int port, string url, string installRoot, EventWaitHandle activate)
    {
        string existingHealth;
        if (TryGet(url + "/api/health", 1500, out existingHealth))
        {
            if (!IsAppHealth(existingHealth)) throw new InvalidOperationException("포트 " + port + "에서 다른 서비스가 응답하고 있습니다. MINWON_PORT를 바꿔 실행해 주세요.");
            // A local server this launcher did not start (for example a development server) keeps running in the browser.
            OpenBrowser(url);
            return 0;
        }
        if (IsPortInUse(port)) throw new InvalidOperationException("포트 " + port + "이(가) 사용 중입니다. 기존 앱을 종료하거나 MINWON_PORT를 바꿔 실행해 주세요.");

        ProcessStartInfo start = new ProcessStartInfo();
        start.FileName = Path.Combine(installRoot, "runtime", "node.exe");
        start.Arguments = "server/index.mjs";
        start.WorkingDirectory = installRoot;
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.EnvironmentVariables["MINWON_PORT"] = port.ToString();

        using (ServerJob job = new ServerJob())
        using (Process server = Process.Start(start))
        {
            if (server == null) throw new InvalidOperationException("로컬 서버 프로세스를 시작하지 못했습니다.");
            job.Add(server);
            try
            {
                WaitForServer(server, url);
                string failure = null;
                bool shown = false;
                try { shown = WebViewHost.Run(version, url, port, Path.Combine(LocalAppData(), "minwon-answer", "webview2"), server, activate, out failure); }
                catch (Exception error) { failure = "WebView2 화면을 열지 못했습니다. " + error.Message; }
                if (!shown) Application.Run(new BrowserModeWindow(version, url, failure, server, activate));
                return 0;
            }
            finally
            {
                try { if (!server.HasExited) server.Kill(); }
                catch { }
            }
        }
    }

    private static int SelfTest()
    {
        string version = ReadEmbeddedVersion();
        string tempRoot = Path.Combine(Path.GetTempPath(), "minwon-answer-selftest-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempRoot);
        Process server = null;
        bool passed = false;
        try
        {
            ExtractPayload(tempRoot);
            string marker = File.ReadAllText(Path.Combine(tempRoot, "app-version.txt"), Encoding.UTF8).Trim();
            if (marker != version) throw new InvalidOperationException("실행 파일과 포함된 앱 버전이 다릅니다.");
            foreach (string file in WebViewFiles)
            {
                if (!File.Exists(Path.Combine(tempRoot, file))) throw new InvalidOperationException("WebView2 구성 파일이 없습니다: " + file);
            }

            string nodePath = Path.Combine(tempRoot, "runtime", "node.exe");
            string expectedNode = File.ReadAllText(Path.Combine(tempRoot, "runtime-version.txt"), Encoding.UTF8).Trim();
            string actualNode = RunAndCapture(nodePath, "--version", tempRoot).Trim();
            if (actualNode != expectedNode) throw new InvalidOperationException("포함된 Node.js 런타임 버전이 예상과 다릅니다.");

            // Load the bundled WebView2 DLLs in a child process so the files are unlocked again before cleanup.
            string webView = RunAndCapture(Assembly.GetExecutingAssembly().Location, "--webview-probe \"" + tempRoot + "\"", tempRoot).Trim();
            if (!webView.StartsWith("webview2=", StringComparison.Ordinal)) throw new InvalidOperationException("WebView2 구성 파일을 불러오지 못했습니다.");

            int port = GetFreePort();
            string url = "http://127.0.0.1:" + port.ToString();
            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = nodePath;
            start.Arguments = "server/index.mjs";
            start.WorkingDirectory = tempRoot;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.EnvironmentVariables["MINWON_PORT"] = port.ToString();
            server = Process.Start(start);
            if (server == null) throw new InvalidOperationException("격리 검증용 로컬 서버를 시작하지 못했습니다.");

            WaitForServer(server, url);
            // The server reports its own version; it must match the version the EXE was built and installed as.
            if (Get(url + "/api/health", 3000).IndexOf("\"version\":\"" + version + "\"", StringComparison.Ordinal) < 0) throw new InvalidOperationException("서버 버전(APP_VERSION)이 실행 파일 버전과 다릅니다.");
            string page = Get(url + "/", 3000);
            if (page.Length < 100 || page.IndexOf("<title>", StringComparison.OrdinalIgnoreCase) < 0) throw new InvalidOperationException("웹 화면 응답을 확인하지 못했습니다.");
            string config = Get(url + "/api/config", 3000);
            if (config.IndexOf("fields", StringComparison.Ordinal) < 0 || config.IndexOf("types", StringComparison.Ordinal) < 0) throw new InvalidOperationException("앱 설정 API 응답이 올바르지 않습니다.");

            Console.WriteLine("SELF_TEST_PASS version=" + version + " node=" + actualNode + " " + webView + " routes=health,index,config");
            passed = true;
            return 0;
        }
        finally
        {
            if (server != null)
            {
                try { if (!server.HasExited) server.Kill(); }
                catch { }
                try { server.WaitForExit(5000); }
                catch { }
                server.Dispose();
            }
            if (passed) DeleteSelfTestDirectory(tempRoot);
            else Console.Error.WriteLine("격리 검증 자료는 오류 확인을 위해 임시 폴더에 남겼습니다: " + tempRoot);
        }
    }

    private static string ReadEmbeddedVersion()
    {
        using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(VersionResource))
        {
            if (stream == null) throw new InvalidOperationException("앱 버전 리소스가 없습니다.");
            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8, true))
            {
                string version = reader.ReadToEnd().Trim();
                if (!Regex.IsMatch(version, "^[0-9]+\\.[0-9]+\\.[0-9]+$")) throw new InvalidOperationException("앱 버전 형식이 올바르지 않습니다.");
                return version;
            }
        }
    }

    // Identifies the exact build (payload hash) so a rebuilt EXE of the same version never runs an older install.
    private static string ReadEmbeddedBuild()
    {
        using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(BuildResource))
        {
            if (stream == null) throw new InvalidOperationException("앱 빌드 리소스가 없습니다.");
            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8, true))
            {
                string build = reader.ReadToEnd().Trim();
                if (!Regex.IsMatch(build, "^[0-9a-f]{12}$")) throw new InvalidOperationException("앱 빌드 형식이 올바르지 않습니다.");
                return build;
            }
        }
    }

    private static string LocalAppData()
    {
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (String.IsNullOrEmpty(localAppData)) throw new InvalidOperationException("현재 사용자 앱 데이터 경로를 확인하지 못했습니다.");
        return localAppData;
    }

    private static bool IsCompleteInstall(string installRoot, string version, string build)
    {
        // The installed marker holds "<version>\n<build>"; the payload's own marker holds only the version.
        string markerPath = Path.Combine(installRoot, "app-version.txt");
        if (!File.Exists(markerPath)) return false;
        string[] marker = File.ReadAllText(markerPath, Encoding.UTF8).Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
        if (marker.Length != 2 || marker[0].Trim() != version || marker[1].Trim() != build) return false;
        if (!File.Exists(Path.Combine(installRoot, ExecutableName)) ||
            !File.Exists(Path.Combine(installRoot, "runtime", "node.exe")) ||
            !File.Exists(Path.Combine(installRoot, "server", "index.mjs")) ||
            !File.Exists(Path.Combine(installRoot, "public", "index.html"))) return false;
        foreach (string file in WebViewFiles)
        {
            if (!File.Exists(Path.Combine(installRoot, file))) return false;
        }
        return true;
    }

    private static void EnsureInstalled(string installRoot, string version, string build)
    {
        if (Directory.Exists(installRoot))
        {
            if (!IsCompleteInstall(installRoot, version, build)) throw new InvalidOperationException("설치 폴더가 불완전하거나 다른 빌드입니다. 기존 파일을 자동 삭제하지 않았습니다: " + installRoot);
            return;
        }

        string parent = Path.GetDirectoryName(installRoot);
        Directory.CreateDirectory(parent);
        string staging = Path.Combine(parent, ".minwon-answer-stage-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(staging);
        try
        {
            ExtractPayload(staging);
            File.WriteAllText(Path.Combine(staging, "app-version.txt"), version + "\n" + build + "\n", new UTF8Encoding(false));
            File.Copy(Assembly.GetExecutingAssembly().Location, Path.Combine(staging, ExecutableName), false);
            if (!IsCompleteInstall(staging, version, build)) throw new InvalidOperationException("설치 파일 구성이 올바르지 않습니다.");
            Directory.Move(staging, installRoot);
        }
        catch
        {
            try { if (Directory.Exists(staging)) Directory.Delete(staging, true); }
            catch { }
            throw;
        }
    }

    private static void ExtractPayload(string destination)
    {
        string root = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResource))
        {
            if (stream == null) throw new InvalidOperationException("실행 파일에 포함된 앱 자료를 찾지 못했습니다.");
            using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read, false))
            {
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    string relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
                    if (String.IsNullOrEmpty(relative) || Path.IsPathRooted(relative)) throw new InvalidOperationException("패키지 경로가 올바르지 않습니다.");
                    string[] parts = relative.Split(Path.DirectorySeparatorChar);
                    foreach (string part in parts)
                    {
                        if (part == ".." || part == ".") throw new InvalidOperationException("패키지 경로가 설치 폴더 밖을 가리킵니다.");
                    }
                    string target = Path.GetFullPath(Path.Combine(root, relative));
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("패키지 경로가 설치 폴더 밖을 가리킵니다.");
                    if (entry.FullName.EndsWith("/", StringComparison.Ordinal) || entry.FullName.EndsWith("\\", StringComparison.Ordinal))
                    {
                        Directory.CreateDirectory(target);
                    }
                    else
                    {
                        string parent = Path.GetDirectoryName(target);
                        if (!Directory.Exists(parent)) Directory.CreateDirectory(parent);
                        using (Stream input = entry.Open())
                        using (FileStream output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                        {
                            input.CopyTo(output);
                        }
                    }
                }
            }
        }
    }

    private static void CreateStartMenuShortcut(string executable, string workingDirectory)
    {
        try
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (String.IsNullOrEmpty(appData)) return;
            string menu = Path.Combine(appData, "Microsoft", "Windows", "Start Menu", "Programs");
            Directory.CreateDirectory(menu);
            string shortcutPath = Path.Combine(menu, "민원답변 도우미.lnk");
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            object shell = Activator.CreateInstance(shellType);
            object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
            Type shortcutType = shortcut.GetType();
            shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { executable });
            shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDirectory });
            shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "PC에서 실행되는 민원답변 도우미" });
            shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }
        catch
        {
            // The installed program can still be opened directly; a missing shortcut does not block the app.
        }
    }

    private static void WaitForServer(Process server, string url)
    {
        DateTime deadline = DateTime.UtcNow.AddSeconds(20);
        while (DateTime.UtcNow < deadline)
        {
            if (server.HasExited) throw new InvalidOperationException("로컬 서버가 종료되었습니다. 종료 코드: " + server.ExitCode.ToString());
            string health;
            if (TryGet(url + "/api/health", 1000, out health))
            {
                if (!IsAppHealth(health)) throw new InvalidOperationException("예상한 민원답변 도우미 서버 응답이 아닙니다.");
                return;
            }
            Thread.Sleep(300);
        }
        throw new TimeoutException("20초 안에 로컬 서버가 준비되지 않았습니다.");
    }

    private static bool TryGet(string url, int timeout, out string body)
    {
        body = String.Empty;
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = "GET";
            request.Timeout = timeout;
            request.ReadWriteTimeout = timeout;
            request.KeepAlive = false;
            request.Proxy = null;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                if (response.StatusCode != HttpStatusCode.OK) return false;
                body = reader.ReadToEnd();
                return true;
            }
        }
        catch { return false; }
    }

    private static string Get(string url, int timeout)
    {
        string body;
        if (!TryGet(url, timeout, out body)) throw new InvalidOperationException("로컬 앱 API 요청이 실패했습니다: " + url);
        return body;
    }

    private static bool IsAppHealth(string body)
    {
        return body.IndexOf("\"ok\":true", StringComparison.Ordinal) >= 0 &&
            body.IndexOf("\"storage\":\"memory-only\"", StringComparison.Ordinal) >= 0 &&
            body.IndexOf("\"deployment\":\"loopback-only\"", StringComparison.Ordinal) >= 0;
    }

    private static bool IsPortInUse(int port)
    {
        TcpListener listener = null;
        try
        {
            listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start();
            return false;
        }
        catch (SocketException) { return true; }
        finally { if (listener != null) listener.Stop(); }
    }

    private static int ResolvePort()
    {
        string configured = Environment.GetEnvironmentVariable("MINWON_PORT");
        if (String.IsNullOrEmpty(configured)) return 8793;
        int port;
        if (!Int32.TryParse(configured, out port) || port < 1024 || port > 65535) throw new InvalidOperationException("MINWON_PORT 값은 1024~65535 사이여야 합니다.");
        return port;
    }

    private static int GetFreePort()
    {
        TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static string RunAndCapture(string executable, string arguments, string workingDirectory)
    {
        ProcessStartInfo start = new ProcessStartInfo();
        start.FileName = executable;
        start.Arguments = arguments;
        start.WorkingDirectory = workingDirectory;
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        start.StandardOutputEncoding = Encoding.UTF8;
        start.StandardErrorEncoding = Encoding.UTF8;
        using (Process process = Process.Start(start))
        {
            if (process == null) throw new InvalidOperationException("검증 프로세스를 시작하지 못했습니다: " + Path.GetFileName(executable));
            // Read both streams asynchronously so the timeout below also applies to a child that hangs.
            Task<string> output = process.StandardOutput.ReadToEndAsync();
            Task<string> error = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(30000))
            {
                try { process.Kill(); }
                catch { }
                throw new TimeoutException("검증 프로세스가 시간 초과됐습니다: " + Path.GetFileName(executable));
            }
            Task.WaitAll(new Task[] { output, error }, 5000);
            if (process.ExitCode != 0) throw new InvalidOperationException("검증 프로세스가 실패했습니다: " + Path.GetFileName(executable) + " " + (error.IsCompleted ? error.Result.Trim() : String.Empty));
            return output.IsCompleted ? output.Result : String.Empty;
        }
    }

    internal static bool IsWebUrl(string value, out Uri uri)
    {
        return Uri.TryCreate(value, UriKind.Absolute, out uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp);
    }

    // Only http(s) addresses are handed to the default browser; anything else from the page is ignored.
    internal static void OpenBrowser(string url)
    {
        Uri uri;
        if (!IsWebUrl(url, out uri)) return;
        try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
        catch (Exception error) { ShowError("브라우저를 자동으로 열지 못했습니다. 브라우저에서 다음 주소를 직접 여세요.\n\n" + uri.AbsoluteUri + "\n\n" + error.Message); }
    }

    // Windows without an owner open on the screen under the mouse, so size them for that screen.
    internal static Rectangle StartScreenArea()
    {
        return Screen.FromPoint(Cursor.Position).WorkingArea;
    }

    // The process is system-DPI aware, so window sizes are physical pixels scaled from a 96-DPI layout.
    internal static float DisplayScale()
    {
        try
        {
            using (Graphics graphics = Graphics.FromHwnd(IntPtr.Zero)) return Math.Max(1f, graphics.DpiX / 96f);
        }
        catch { return 1f; }
    }

    internal static void ShowError(string message)
    {
        MessageBox.Show(message, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    internal static RegisteredWaitHandle ListenForActivation(Form form, EventWaitHandle activate, MethodInvoker onActivate)
    {
        return ThreadPool.RegisterWaitForSingleObject(activate, delegate(object state, bool timedOut)
        {
            try
            {
                if (form.IsHandleCreated && !form.IsDisposed) form.BeginInvoke((MethodInvoker)delegate
                {
                    if (form.WindowState == FormWindowState.Minimized) form.WindowState = FormWindowState.Normal;
                    form.Activate();
                    if (onActivate != null) onActivate();
                });
            }
            catch (InvalidOperationException) { }
        }, null, Timeout.Infinite, false);
    }

    private static void UseUtf8StandardStreams()
    {
        // GUI executables have no console of their own; tests read these streams through redirection.
        Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
        Console.SetError(new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false)) { AutoFlush = true });
    }

    private static void DeleteSelfTestDirectory(string path)
    {
        string tempPrefix = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string full = Path.GetFullPath(path);
        if (!full.StartsWith(tempPrefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("격리 검증 임시 경로가 시스템 임시 폴더 밖입니다.");
        if (Directory.Exists(full)) Directory.Delete(full, true);
    }

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    private static extern bool AllowSetForegroundWindow(int processId);
}

// Kills the local server (and any AI CLI it started) when the launcher exits, even after a crash.
internal sealed class ServerJob : IDisposable
{
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint KillOnJobClose = 0x2000;
    private IntPtr handle;

    public ServerJob()
    {
        handle = CreateJobObject(IntPtr.Zero, null);
        if (handle == IntPtr.Zero) return;
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = KillOnJobClose;
        if (!SetInformationJobObject(handle, JobObjectExtendedLimitInformation, ref info, (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))))
        {
            CloseHandle(handle);
            handle = IntPtr.Zero;
        }
    }

    public void Add(Process process)
    {
        // Without a job the launcher still stops the server in its finally block.
        if (handle != IntPtr.Zero) AssignProcessToJobObject(handle, process.Handle);
    }

    public void Dispose()
    {
        if (handle == IntPtr.Zero) return;
        CloseHandle(handle);
        handle = IntPtr.Zero;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll")]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length);

    [DllImport("kernel32.dll")]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
}

// Every WebView2 type stays behind these non-inlined methods, so a missing DLL surfaces as a catchable
// exception at the call site and the launcher can fall back to the browser.
internal static class WebViewHost
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static bool Run(string version, string url, int port, string userDataFolder, Process server, EventWaitHandle activate, out string failure)
    {
        failure = null;
        string runtime;
        try { runtime = CoreWebView2Environment.GetAvailableBrowserVersionString(null); }
        catch (WebView2RuntimeNotFoundException) { runtime = null; }
        if (String.IsNullOrEmpty(runtime))
        {
            failure = "이 PC에 Microsoft Edge WebView2 런타임이 없어 앱 창 대신 브라우저로 화면을 엽니다.";
            return false;
        }
        Directory.CreateDirectory(userDataFolder);
        using (AppWindow window = new AppWindow(version, url, port, userDataFolder, server, activate))
        {
            Application.Run(window);
            if (window.FailureMessage == null) return true;
            failure = window.FailureMessage;
            return false;
        }
    }
}

internal static class WebViewProbe
{
    // Build-time check that the bundled DLLs load (WebView2 runtime may legitimately be absent on the build PC).
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static int Run(string folder)
    {
        if (String.IsNullOrEmpty(folder) || !Directory.Exists(folder)) throw new InvalidOperationException("WebView2 검사 폴더가 없습니다.");
        AppDomain.CurrentDomain.AssemblyResolve += delegate(object sender, ResolveEventArgs args)
        {
            string candidate = Path.Combine(folder, new AssemblyName(args.Name).Name + ".dll");
            return File.Exists(candidate) ? Assembly.LoadFrom(candidate) : null;
        };
        Console.WriteLine("webview2=" + RuntimeVersion(folder));
        return 0;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static string RuntimeVersion(string folder)
    {
        CoreWebView2Environment.SetLoaderDllFolderPath(folder);
        try
        {
            string runtime = CoreWebView2Environment.GetAvailableBrowserVersionString(null);
            return String.IsNullOrEmpty(runtime) ? "missing" : runtime.Replace(' ', '_');
        }
        catch (WebView2RuntimeNotFoundException) { return "missing"; }
    }
}

internal sealed class AppWindow : Form
{
    private readonly WebView2 webView;
    private readonly string url;
    private readonly int port;
    private readonly Process server;
    private readonly RegisteredWaitHandle activation;
    private readonly System.Windows.Forms.Timer statusTimer;
    private bool allowClose;
    private bool checkingClose;
    private DateTime closeCheckStarted;
    private bool checkingStatus;
    private bool serverStopped;
    private bool blockingShutdown;
    // Last answer from the page, polled in the background because Windows asks about shutdown synchronously.
    private string lastStatus = "clean";
    private int activeWorkDownloads;
    private bool workDownloadFailed;

    public string FailureMessage { get; private set; }

    public AppWindow(string version, string url, int port, string userDataFolder, Process server, EventWaitHandle activate)
    {
        this.url = url;
        this.port = port;
        this.server = server;
        Text = Program.AppTitle + " " + version;
        StartPosition = FormStartPosition.Manual;
        float scale = Program.DisplayScale();
        Rectangle area = Program.StartScreenArea();
        Size = new Size(Math.Min((int)(1320 * scale), area.Width - 40), Math.Min((int)(900 * scale), area.Height - 40));
        MinimumSize = new Size(Math.Min((int)(760 * scale), area.Width - 40), Math.Min((int)(560 * scale), area.Height - 40));
        Location = new Point(area.Left + (area.Width - Width) / 2, area.Top + (area.Height - Height) / 2);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
        catch { }

        webView = new WebView2();
        webView.Dock = DockStyle.Fill;
        CoreWebView2CreationProperties properties = new CoreWebView2CreationProperties();
        properties.UserDataFolder = userDataFolder;
        // InPrivate keeps cookies, cache and storage in memory, matching the memory-only server.
        properties.IsInPrivateModeEnabled = true;
        properties.Language = "ko-KR";
        webView.CreationProperties = properties;
        Controls.Add(webView);

        statusTimer = new System.Windows.Forms.Timer();
        statusTimer.Interval = 2000;
        statusTimer.Tick += OnStatusTick;

        activation = Program.ListenForActivation(this, activate, null);
        server.Exited += OnServerExited;
        server.EnableRaisingEvents = true;
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try
        {
            await webView.EnsureCoreWebView2Async(null);
            CoreWebView2 core = webView.CoreWebView2;
            CoreWebView2Settings settings = core.Settings;
            settings.AreDevToolsEnabled = false;
            settings.AreHostObjectsAllowed = false;
            settings.IsWebMessageEnabled = false;
            settings.IsStatusBarEnabled = false;
            settings.IsGeneralAutofillEnabled = false;
            settings.IsPasswordAutosaveEnabled = false;
            core.NewWindowRequested += OnNewWindowRequested;
            core.NavigationStarting += OnNavigationStarting;
            core.PermissionRequested += OnPermissionRequested;
            core.ProcessFailed += OnProcessFailed;
            core.DownloadStarting += OnDownloadStarting;
            core.Navigate(url + "/");
            statusTimer.Start();
        }
        catch (Exception error)
        {
            // Nothing was shown yet, so the launcher can safely switch to the browser.
            FailureMessage = "WebView2 화면을 준비하지 못해 브라우저로 화면을 엽니다. " + error.Message;
            allowClose = true;
            Close();
        }
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        // An exit that happened before the window existed raised no event this window could handle.
        if (server.HasExited) HandleServerStopped();
    }

    private bool IsAppAddress(Uri uri)
    {
        return uri.Scheme == Uri.UriSchemeHttp && uri.Host == "127.0.0.1" && uri.Port == port;
    }

    private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        // External links (law sites, GitHub) open in the default browser; the app never opens extra windows.
        e.Handled = true;
        Uri uri;
        if (Program.IsWebUrl(e.Uri, out uri) && !IsAppAddress(uri)) Program.OpenBrowser(uri.AbsoluteUri);
    }

    private void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
    {
        // Only the local app (and its own download blobs) loads in this window; web pages go to the default browser.
        Uri uri;
        bool web = Program.IsWebUrl(e.Uri, out uri);
        if (web && IsAppAddress(uri)) return;
        if (e.Uri.StartsWith("blob:" + url + "/", StringComparison.Ordinal)) return;
        e.Cancel = true;
        if (web) Program.OpenBrowser(uri.AbsoluteUri);
    }

    private void OnPermissionRequested(object sender, CoreWebView2PermissionRequestedEventArgs e)
    {
        // Repeated downloads from the app's own page (answer file, work file) must not be blocked silently.
        Uri uri;
        bool ownPage = Program.IsWebUrl(e.Uri, out uri) && IsAppAddress(uri);
        e.State = ownPage && e.PermissionKind == CoreWebView2PermissionKind.MultipleAutomaticDownloads ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
    }

    // The page marks work as exported when the download starts; the window tracks whether the work file was really saved.
    private void OnDownloadStarting(object sender, CoreWebView2DownloadStartingEventArgs e)
    {
        string path = e.ResultFilePath ?? String.Empty;
        if (!path.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) return;
        CoreWebView2DownloadOperation operation = e.DownloadOperation;
        bool finished = false;
        activeWorkDownloads++;
        operation.StateChanged += delegate(object source, object args)
        {
            if (finished || operation.State == CoreWebView2DownloadState.InProgress) return;
            finished = true;
            activeWorkDownloads--;
            workDownloadFailed = operation.State == CoreWebView2DownloadState.Interrupted;
        };
    }

    private void OnProcessFailed(object sender, CoreWebView2ProcessFailedEventArgs e)
    {
        if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited)
        {
            // The browser process keeps the session cookie, so a reload brings back the work held by the server.
            try { webView.Reload(); }
            catch { }
        }
        else if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
        {
            allowClose = true;
            Program.ShowError("화면 구성 요소(WebView2)가 비정상 종료되어 작업 화면을 다시 열 수 없습니다. 프로그램을 다시 실행해 주세요.");
            Close();
        }
    }

    private void OnServerExited(object sender, EventArgs e)
    {
        try
        {
            if (IsHandleCreated && !IsDisposed) BeginInvoke((MethodInvoker)HandleServerStopped);
        }
        catch (InvalidOperationException) { }
    }

    // The window stays open: the screen still holds the last work, which ‘작업 내보내기’ can save without the server.
    private void HandleServerStopped()
    {
        if (serverStopped || allowClose) return;
        serverStopped = true;
        MessageBox.Show(this, "로컬 서버가 예기치 않게 종료되어 작업을 더 진행할 수 없습니다.\n\n화면에 남은 작업은 ‘작업 내보내기’로 저장할 수 있습니다. 저장한 뒤 창을 닫고 프로그램을 다시 실행해 주세요.", Program.AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    private async void OnStatusTick(object sender, EventArgs e)
    {
        if (checkingStatus || allowClose) return;
        checkingStatus = true;
        string status;
        try { status = await CloseStatusAsync(); }
        catch (Exception) { status = "unknown"; }
        checkingStatus = false;
        lastStatus = status;
        UpdateShutdownBlock();
    }

    // Lets Windows show why this app delays a restart or sign-out while work is not saved to a file.
    private void UpdateShutdownBlock()
    {
        if (!IsHandleCreated || IsDisposed) return;
        bool block = lastStatus != "clean";
        if (block && !blockingShutdown) blockingShutdown = ShutdownBlockReasonCreate(Handle, "파일로 내보내지 않은 민원 작업이 있습니다. 앱 창에서 ‘작업 내보내기’로 저장하세요.");
        else if (!block && blockingShutdown)
        {
            ShutdownBlockReasonDestroy(Handle);
            blockingShutdown = false;
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (allowClose)
        {
            base.OnFormClosing(e);
            return;
        }
        if (e.CloseReason == CloseReason.WindowsShutDown)
        {
            // Windows needs an immediate answer, so the last polled status decides; Windows then shows the block reason.
            if (lastStatus != "clean") e.Cancel = true;
            base.OnFormClosing(e);
            return;
        }
        // Closing ends the memory-only server, so ask the page whether work would be lost before closing.
        e.Cancel = true;
        if (!checkingClose)
        {
            base.OnFormClosing(e);
            ConfirmClose();
            return;
        }
        // A check that has not answered for 5 seconds must never leave the window impossible to close.
        if (DateTime.UtcNow - closeCheckStarted > TimeSpan.FromSeconds(5) && AskClose("unknown"))
        {
            allowClose = true;
            e.Cancel = false;
        }
        base.OnFormClosing(e);
    }

    private async void ConfirmClose()
    {
        checkingClose = true;
        closeCheckStarted = DateTime.UtcNow;
        string status;
        try { status = await CloseStatusAsync(); }
        catch (Exception) { status = "unknown"; }
        checkingClose = false;
        if (status == "clean" || AskClose(status))
        {
            allowClose = true;
            Close();
        }
    }

    private async Task<string> CloseStatusAsync()
    {
        if (activeWorkDownloads > 0) return "downloading";
        if (webView.CoreWebView2 == null) return "clean";
        Task<string> script = webView.ExecuteScriptAsync("(function(){try{return typeof window.minwonAnswerCloseCheck==='function'?window.minwonAnswerCloseCheck():'unknown';}catch(e){return 'unknown';}})()");
        Task finished = await Task.WhenAny(script, Task.Delay(2000));
        if (finished != script) return "unknown";
        string result = await script;
        if (result == "\"clean\"") return workDownloadFailed ? "unsaved" : "clean";
        if (result == "\"busy\"") return "busy";
        if (result == "\"unsaved\"") return "unsaved";
        return "unknown";
    }

    private bool AskClose(string status)
    {
        string message;
        if (status == "busy") message = "AI 작업이 실행 중입니다.\n\n창을 닫으면 실행이 중단되고 입력·답변 버전·검토 기록이 모두 삭제됩니다.\n\n그래도 닫을까요?";
        else if (status == "downloading") message = "작업 파일을 내려받는 중입니다.\n\n지금 닫으면 파일이 저장되지 않을 수 있습니다. 잠시 뒤 다시 닫는 것이 안전합니다.\n\n그래도 닫을까요?";
        else if (status == "unsaved") message = "파일로 내보내지 않은 작업이 있습니다.\n\n창을 닫으면 입력·답변 버전·검토 기록이 모두 삭제됩니다. 이어서 작업하려면 [아니요]를 누른 뒤 ‘작업 내보내기’로 저장하세요.\n\n저장하지 않고 닫을까요?";
        else message = "작업을 저장했는지 확인하지 못했습니다.\n\n창을 닫으면 작업 내용이 모두 삭제됩니다.\n\n그래도 닫을까요?";
        return MessageBox.Show(this, message, Program.AppTitle, MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        statusTimer.Stop();
        statusTimer.Dispose();
        if (blockingShutdown)
        {
            ShutdownBlockReasonDestroy(Handle);
            blockingShutdown = false;
        }
        server.Exited -= OnServerExited;
        activation.Unregister(null);
        base.OnFormClosed(e);
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool ShutdownBlockReasonCreate(IntPtr window, string reason);

    [DllImport("user32.dll")]
    private static extern bool ShutdownBlockReasonDestroy(IntPtr window);
}

// Shown when WebView2 is unavailable: the screen opens in the default browser and this window controls the server.
internal sealed class BrowserModeWindow : Form
{
    private readonly Process server;
    private readonly RegisteredWaitHandle activation;
    private bool allowClose;

    public BrowserModeWindow(string version, string url, string reason, Process server, EventWaitHandle activate)
    {
        this.server = server;
        Text = Program.AppTitle + " " + version;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Font = new Font("Malgun Gothic", 9.5f);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
        catch { }

        TableLayoutPanel layout = new TableLayoutPanel();
        layout.AutoSize = true;
        layout.AutoSizeMode = AutoSizeMode.GrowAndShrink;
        layout.Padding = new Padding(18);
        layout.ColumnCount = 1;
        Label label = new Label();
        label.AutoSize = true;
        label.MaximumSize = new Size((int)(460 * Program.DisplayScale()), 0);
        label.Text = (reason ?? "브라우저로 화면을 엽니다.") + "\n\n화면 주소: " + url + "\n\n이 창을 닫으면 프로그램이 끝나고 작업 내용이 삭제됩니다. 이어서 작업하려면 먼저 화면에서 ‘작업 내보내기’로 저장하세요.";
        FlowLayoutPanel buttons = new FlowLayoutPanel();
        buttons.AutoSize = true;
        buttons.FlowDirection = FlowDirection.RightToLeft;
        buttons.Dock = DockStyle.Fill;
        buttons.Margin = new Padding(0, 14, 0, 0);
        Button exit = new Button();
        exit.Text = "종료";
        exit.AutoSize = true;
        exit.Click += delegate { Close(); };
        Button open = new Button();
        open.Text = "브라우저에서 열기";
        open.AutoSize = true;
        open.Click += delegate { Program.OpenBrowser(url); };
        buttons.Controls.Add(exit);
        buttons.Controls.Add(open);
        layout.Controls.Add(label);
        layout.Controls.Add(buttons);
        Controls.Add(layout);

        // A second launch reopens the browser screen as well, since the browser tab is the only work screen here.
        activation = Program.ListenForActivation(this, activate, delegate { Program.OpenBrowser(url); });
        server.Exited += OnServerExited;
        server.EnableRaisingEvents = true;
        Shown += delegate
        {
            if (server.HasExited) HandleServerStopped();
            else Program.OpenBrowser(url);
        };
    }

    private void OnServerExited(object sender, EventArgs e)
    {
        try
        {
            if (IsHandleCreated && !IsDisposed) BeginInvoke((MethodInvoker)HandleServerStopped);
        }
        catch (InvalidOperationException) { }
    }

    private void HandleServerStopped()
    {
        if (allowClose) return;
        allowClose = true;
        // The browser tab keeps the last screen, so its ‘작업 내보내기’ still works after this window closes.
        MessageBox.Show(this, "로컬 서버가 예기치 않게 종료되었습니다.\n\n브라우저 화면의 ‘작업 내보내기’로 화면에 남은 작업을 저장한 뒤 프로그램을 다시 실행해 주세요.", Program.AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        Close();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!allowClose && e.CloseReason != CloseReason.WindowsShutDown &&
            MessageBox.Show(this, "종료하면 입력·답변 버전·검토 기록이 모두 삭제됩니다.\n\n이어서 작업하려면 [아니요]를 누른 뒤 브라우저 화면에서 ‘작업 내보내기’로 저장하세요.\n\n종료할까요?", Program.AppTitle, MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
        {
            e.Cancel = true;
        }
        base.OnFormClosing(e);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        server.Exited -= OnServerExited;
        activation.Unregister(null);
        base.OnFormClosed(e);
    }
}
