# Island system bridge
# Long-lived helper: streams media session, master volume and network state
# as JSON lines on stdout, and accepts JSON commands on stdin.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -AssemblyName System.Runtime.WindowsRuntime

Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Threading;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int f();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

public static class IslandAudio {
  static IAudioEndpointVolume Endpoint() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume epv = null;
    var epvid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref epvid, 23, 0, out epv));
    return epv;
  }
  public static float GetVolume() { float v = -1; Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out v)); return v; }
  public static void SetVolume(float v) { Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, v)), Guid.Empty)); }
  public static bool GetMute() { bool m; Marshal.ThrowExceptionForHR(Endpoint().GetMute(out m)); return m; }
  public static void SetMute(bool m) { Marshal.ThrowExceptionForHR(Endpoint().SetMute(m, Guid.Empty)); }
}

public static class IslandStdin {
  static readonly ConcurrentQueue<string> Queue = new ConcurrentQueue<string>();
  public static void Start() {
    var t = new Thread(() => {
      try {
        var reader = new System.IO.StreamReader(Console.OpenStandardInput());
        string line;
        while ((line = reader.ReadLine()) != null) Queue.Enqueue(line);
      } catch { }
      Queue.Enqueue("__eof__");
    });
    t.IsBackground = true;
    t.Start();
  }
  public static string Next() { string s; return Queue.TryDequeue(out s) ? s : null; }
}
'@

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]))

function Await($op, [Type]$type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(4000)) { throw 'winrt timeout' }
  $task.Result
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]

$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

function Emit($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}

$epoch = [DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
$lastMediaJson = ''
$lastTrackKey = $null
$lastArt = $null
$lastVolumeJson = ''
$lastNetJson = ''

function Read-Thumbnail($props) {
  try {
    if ($null -eq $props.Thumbnail) { return $null }
    $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    # The stream arrives as a bare __ComObject, so bind the extension method explicitly.
    $netStream = $asStreamForRead.Invoke($null, @($stream))
    $ms = New-Object System.IO.MemoryStream
    $netStream.CopyTo($ms)
    $netStream.Dispose()
    $bytes = $ms.ToArray()
    if ($bytes.Length -lt 8) { return $null }
    $type = 'image/jpeg'
    if ($bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50) { $type = 'image/png' }
    elseif ($bytes[0] -eq 0x52 -and $bytes[1] -eq 0x49) { $type = 'image/webp' }
    elseif ($bytes[0] -eq 0x42 -and $bytes[1] -eq 0x4D) { $type = 'image/bmp' }
    return "data:$type;base64," + [Convert]::ToBase64String($bytes)
  } catch { return $null }
}

function Poll-Media([bool]$force) {
  $session = $null
  try { $session = $manager.GetCurrentSession() } catch { }
  if ($null -eq $session) {
    $json = '{"type":"media","active":false}'
    if ($force -or $json -ne $lastMediaJson) {
      $script:lastMediaJson = $json
      $script:lastTrackKey = $null
      [Console]::Out.WriteLine($json); [Console]::Out.Flush()
    }
    return
  }

  $props = $null
  try { $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]) } catch { }
  $info = $session.GetPlaybackInfo()
  $tl = $session.GetTimelineProperties()

  $title = ''; $artist = ''; $album = ''
  if ($props) { $title = $props.Title; $artist = $props.Artist; $album = $props.AlbumTitle }
  if (-not $artist -and $props) { $artist = $props.AlbumArtist }

  $key = "$($session.SourceAppUserModelId)|$title|$artist"
  $artChanged = $false
  if ($key -ne $lastTrackKey) {
    $script:lastTrackKey = $key
    $script:lastArt = if ($props) { Read-Thumbnail $props } else { $null }
    $artChanged = $true
  }

  $updated = 0
  if ($tl.LastUpdatedTime -gt $epoch) { $updated = $tl.LastUpdatedTime.ToUnixTimeMilliseconds() }
  $controls = $info.Controls

  $state = [ordered]@{
    type     = 'media'
    active   = $true
    app      = $session.SourceAppUserModelId
    title    = $title
    artist   = $artist
    album    = $album
    status   = [string]$info.PlaybackStatus
    position = [math]::Round($tl.Position.TotalMilliseconds)
    duration = [math]::Round(($tl.EndTime - $tl.StartTime).TotalMilliseconds)
    updated  = $updated
    canPrev  = [bool]$controls.IsPreviousEnabled
    canNext  = [bool]$controls.IsNextEnabled
    canSeek  = [bool]$controls.IsPlaybackPositionEnabled
  }
  $json = $state | ConvertTo-Json -Compress
  if ($force -or $artChanged -or $json -ne $lastMediaJson) {
    $script:lastMediaJson = $json
    if ($artChanged -or $force) { $state.art = $lastArt; $state.artKey = $key }
    Emit $state
  }
}

function Poll-Volume([bool]$force) {
  try {
    $state = [ordered]@{ type = 'volume'; level = [math]::Round([IslandAudio]::GetVolume(), 3); muted = [IslandAudio]::GetMute() }
    $json = $state | ConvertTo-Json -Compress
    if ($force -or $json -ne $lastVolumeJson) { $script:lastVolumeJson = $json; [Console]::Out.WriteLine($json); [Console]::Out.Flush() }
  } catch { }
}

function Poll-Network([bool]$force) {
  $state = [ordered]@{ type = 'network'; online = $false; kind = 'none'; name = ''; bars = 0 }
  try {
    $netProfile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
    if ($netProfile) {
      $level = $netProfile.GetNetworkConnectivityLevel()
      $state.online = ([string]$level -eq 'InternetAccess')
      $state.name = $netProfile.ProfileName
      if ($netProfile.IsWlanConnectionProfile) {
        $state.kind = 'wifi'
        try { $ssid = $netProfile.WlanConnectionProfileDetails.GetConnectedSsid(); if ($ssid) { $state.name = $ssid } } catch { }
      } elseif ($netProfile.IsWwanConnectionProfile) { $state.kind = 'cellular' }
      else { $state.kind = 'ethernet' }
      try { $b = $netProfile.GetSignalBars(); if ($null -ne $b) { $state.bars = [int]$b } } catch { }
    }
  } catch { }
  $json = $state | ConvertTo-Json -Compress
  if ($force -or $json -ne $lastNetJson) { $script:lastNetJson = $json; [Console]::Out.WriteLine($json); [Console]::Out.Flush() }
}

function Invoke-Command-Line([string]$line) {
  $cmd = $line | ConvertFrom-Json
  switch ($cmd.cmd) {
    'volume' { [IslandAudio]::SetVolume([float]$cmd.value); if ([IslandAudio]::GetMute() -and $cmd.value -gt 0) { [IslandAudio]::SetMute($false) }; Poll-Volume $true; return }
    'mute'   { [IslandAudio]::SetMute([bool]$cmd.value); Poll-Volume $true; return }
    'refresh' { Poll-Media $true; Poll-Volume $true; Poll-Network $true; return }
  }
  $session = $manager.GetCurrentSession()
  if ($null -eq $session) { return }
  switch ($cmd.cmd) {
    'toggle' { $null = Await ($session.TryTogglePlayPauseAsync()) ([bool]) }
    'play'   { $null = Await ($session.TryPlayAsync()) ([bool]) }
    'pause'  { $null = Await ($session.TryPauseAsync()) ([bool]) }
    'next'   { $null = Await ($session.TrySkipNextAsync()) ([bool]) }
    'prev'   { $null = Await ($session.TrySkipPreviousAsync()) ([bool]) }
    # value is milliseconds; WinRT wants 100 ns ticks.
    'seek'   { $null = Await ($session.TryChangePlaybackPositionAsync([long]([double]$cmd.value * 10000))) ([bool]) }
  }
  Start-Sleep -Milliseconds 120
  Poll-Media $true
}

[IslandStdin]::Start()
Emit ([ordered]@{ type = 'ready' })
Poll-Media $true
Poll-Volume $true
Poll-Network $true

$tick = 0
while ($true) {
  $line = [IslandStdin]::Next()
  while ($null -ne $line) {
    if ($line -eq '__eof__') { exit 0 }
    try { Invoke-Command-Line $line } catch { Emit ([ordered]@{ type = 'error'; message = "$($_.Exception.Message)" }) }
    $line = [IslandStdin]::Next()
  }

  if ($tick % 5 -eq 0) { try { Poll-Media $false } catch { } }
  if ($tick % 2 -eq 0) { Poll-Volume $false }
  if ($tick % 50 -eq 0) { Poll-Network $false }

  $tick++
  Start-Sleep -Milliseconds 100
}

