using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

internal static class Program
{
    private const string PayloadResource = "MinwonPayload.zip";
    private const string VersionResource = "MinwonVersion.txt";
    private const string MutexName = @"Local\MinwonAnswerApp";

    private static int Main(string[] args)
    {
        try
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            if (args.Length == 1 && args[0] == "--self-test") return SelfTest();
            return RunApp();
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("민원답변 도우미를 시작하지 못했습니다: " + error.Message);
            Console.Error.WriteLine("문제가 계속되면 이 창을 닫고 다시 실행해 주세요.");
            return 1;
        }
    }

    private static int RunApp()
    {
        string version = ReadEmbeddedVersion();
        int port = ResolvePort();
        string url = "http://127.0.0.1:" + port.ToString();
        bool ownsMutex;

        using (Mutex mutex = new Mutex(true, MutexName, out ownsMutex))
        {
            if (!ownsMutex)
            {
                OpenBrowser(url);
                Console.WriteLine("민원답변 도우미가 이미 실행 중입니다. 기존 화면을 열었습니다.");
                return 0;
            }

            try
            {
                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                if (String.IsNullOrEmpty(localAppData)) throw new InvalidOperationException("현재 사용자 앱 데이터 경로를 확인하지 못했습니다.");
                string programRoot = Path.Combine(localAppData, "Programs", "minwon-answer");
                string installRoot = Path.Combine(programRoot, version);

                EnsureInstalled(installRoot, version);
                CreateStartMenuShortcut(Path.Combine(installRoot, "MinwonAnswer.exe"), installRoot);

                string existingHealth;
                if (TryGet(url + "/api/health", 1500, out existingHealth))
                {
                    if (!IsAppHealth(existingHealth)) throw new InvalidOperationException("포트 " + port + "에서 다른 서비스가 응답하고 있습니다. MINWON_PORT를 바꿔 실행해 주세요.");
                    OpenBrowser(url);
                    Console.WriteLine("이미 실행 중인 로컬 서버를 열었습니다: " + url);
                    return 0;
                }
                if (IsPortInUse(port)) throw new InvalidOperationException("포트 " + port + "이(가) 사용 중입니다. 기존 앱을 종료하거나 MINWON_PORT를 바꿔 실행해 주세요.");

                string nodePath = Path.Combine(installRoot, "runtime", "node.exe");
                ProcessStartInfo start = new ProcessStartInfo();
                start.FileName = nodePath;
                start.Arguments = "server/index.mjs";
                start.WorkingDirectory = installRoot;
                start.UseShellExecute = false;
                start.CreateNoWindow = false;
                start.EnvironmentVariables["MINWON_PORT"] = port.ToString();

                using (Process server = Process.Start(start))
                {
                    if (server == null) throw new InvalidOperationException("로컬 서버 프로세스를 시작하지 못했습니다.");
                    ConsoleCancelEventHandler cancelHandler = delegate(object sender, ConsoleCancelEventArgs eventArgs)
                    {
                        eventArgs.Cancel = true;
                        try { if (!server.HasExited) server.Kill(); }
                        catch { }
                    };
                    Console.CancelKeyPress += cancelHandler;
                    try
                    {
                        WaitForServer(server, url);
                        OpenBrowser(url);
                        Console.WriteLine("민원답변 도우미 실행 중: " + url);
                        Console.WriteLine("이 창에서 Ctrl+C를 누르면 서버가 종료되고 메모리 세션이 삭제됩니다.");
                        Console.WriteLine("AI 로그인 정보는 이 PC의 공식 Codex·Claude 프로그램이 관리합니다.");
                        server.WaitForExit();
                        return server.ExitCode;
                    }
                    finally
                    {
                        Console.CancelKeyPress -= cancelHandler;
                        try { if (!server.HasExited) server.Kill(); }
                        catch { }
                    }
                }
            }
            finally
            {
                mutex.ReleaseMutex();
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

            string nodePath = Path.Combine(tempRoot, "runtime", "node.exe");
            string expectedNode = File.ReadAllText(Path.Combine(tempRoot, "runtime-version.txt"), Encoding.UTF8).Trim();
            string actualNode = RunAndCapture(nodePath, "--version", tempRoot).Trim();
            if (actualNode != expectedNode) throw new InvalidOperationException("포함된 Node.js 런타임 버전이 예상과 다릅니다.");

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
            string page = Get(url + "/", 3000);
            if (page.Length < 100 || page.IndexOf("<title>", StringComparison.OrdinalIgnoreCase) < 0) throw new InvalidOperationException("웹 화면 응답을 확인하지 못했습니다.");
            string config = Get(url + "/api/config", 3000);
            if (config.IndexOf("fields", StringComparison.Ordinal) < 0 || config.IndexOf("types", StringComparison.Ordinal) < 0) throw new InvalidOperationException("앱 설정 API 응답이 올바르지 않습니다.");

            Console.WriteLine("SELF_TEST_PASS version=" + version + " node=" + actualNode + " routes=health,index,config");
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

    private static void EnsureInstalled(string installRoot, string version)
    {
        if (Directory.Exists(installRoot))
        {
            string markerPath = Path.Combine(installRoot, "app-version.txt");
            bool complete = File.Exists(markerPath) && File.ReadAllText(markerPath, Encoding.UTF8).Trim() == version &&
                File.Exists(Path.Combine(installRoot, "MinwonAnswer.exe")) &&
                File.Exists(Path.Combine(installRoot, "runtime", "node.exe")) &&
                File.Exists(Path.Combine(installRoot, "server", "index.mjs")) &&
                File.Exists(Path.Combine(installRoot, "public", "index.html"));
            if (!complete) throw new InvalidOperationException("설치 폴더가 불완전합니다. 기존 파일을 자동 삭제하지 않았습니다: " + installRoot);
            return;
        }

        string parent = Path.GetDirectoryName(installRoot);
        Directory.CreateDirectory(parent);
        string staging = Path.Combine(parent, ".minwon-answer-stage-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(staging);
        try
        {
            ExtractPayload(staging);
            File.WriteAllText(Path.Combine(staging, "app-version.txt"), version + Environment.NewLine, new UTF8Encoding(false));
            File.Copy(Assembly.GetExecutingAssembly().Location, Path.Combine(staging, "MinwonAnswer.exe"), false);
            if (!File.Exists(Path.Combine(staging, "runtime", "node.exe")) || !File.Exists(Path.Combine(staging, "server", "index.mjs")) || !File.Exists(Path.Combine(staging, "public", "index.html")))
                throw new InvalidOperationException("설치 파일 구성이 올바르지 않습니다.");
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
        catch (Exception error)
        {
            Console.WriteLine("시작 메뉴 바로가기를 만들지 못했습니다. 설치된 실행 파일을 직접 열 수 있습니다. " + error.Message);
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
        using (Process process = Process.Start(start))
        {
            if (process == null) throw new InvalidOperationException("Node.js 버전을 확인하지 못했습니다.");
            string output = process.StandardOutput.ReadToEnd();
            string error = process.StandardError.ReadToEnd();
            if (!process.WaitForExit(10000))
            {
                process.Kill();
                throw new TimeoutException("Node.js 버전 확인이 시간 초과됐습니다.");
            }
            if (process.ExitCode != 0) throw new InvalidOperationException("Node.js 버전 확인에 실패했습니다. " + error);
            return output;
        }
    }

    private static void OpenBrowser(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception error) { Console.WriteLine("브라우저를 자동으로 열지 못했습니다. 직접 주소를 여세요: " + url + " (" + error.Message + ")"); }
    }

    private static void DeleteSelfTestDirectory(string path)
    {
        string tempPrefix = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string full = Path.GetFullPath(path);
        if (!full.StartsWith(tempPrefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("격리 검증 임시 경로가 시스템 임시 폴더 밖입니다.");
        if (Directory.Exists(full)) Directory.Delete(full, true);
    }
}
