Add-Type -AssemblyName System.Drawing
$dir = 'd:\workspaces\trae\piano\build'
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

$bmp = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(255, 16, 20, 24))

# 圆角白键主体
$rect = New-Object System.Drawing.Rectangle(30, 90, 196, 120)
$radius = 20
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = $radius * 2
$path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
$path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
$path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
$path.CloseFigure()
$g.FillPath([System.Drawing.Brushes]::White, $path)

# 黑键
$blackBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 28, 34, 42))
$g.FillRectangle($blackBrush, 55, 90, 32, 72)
$g.FillRectangle($blackBrush, 112, 90, 32, 72)
$g.FillRectangle($blackBrush, 169, 90, 32, 72)

# 蓝条
$blueBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 63, 109, 246))
$g.FillRectangle($blueBrush, 96, 200, 64, 12)

$blackBrush.Dispose(); $blueBrush.Dispose(); $g.Dispose()
$bmp.Save("$dir\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)

# 写标准 ICO（PNG 压缩，256x256）
$pngPath = 'd:\workspaces\trae\piano\build\icon.png'
Write-Output "png exists: $(Test-Path $pngPath), size: $(Get-Item $pngPath).Length"
$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
Write-Output "png bytes: $($pngBytes.Length)"
$fs = [System.IO.File]::Create("$dir\icon.ico")
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([uint16]0)        # reserved
$bw.Write([uint16]1)        # type: icon
$bw.Write([uint16]1)        # count
$bw.Write([byte]0)          # width 0=256
$bw.Write([byte]0)          # height 0=256
$bw.Write([byte]0)          # colors
$bw.Write([byte]0)          # reserved
$bw.Write([uint16]1)        # planes
$bw.Write([uint16]32)       # bpp
$bw.Write([uint32]$pngBytes.Length)  # size
$bw.Write([uint32]22)       # offset
$bw.Write([byte[]]$pngBytes, 0, $pngBytes.Length)
$bw.Close(); $fs.Close()
$bmp.Dispose()
Write-Output 'icon.ico (256x256 PNG-encoded) + icon.png created'
