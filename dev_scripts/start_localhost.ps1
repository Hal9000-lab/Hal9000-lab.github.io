Write-Host "Starting simple HTTP server for 10 hours..."
Write-Host "Access your app at: http://localhost:8000"
Write-Host "Press Ctrl+C to stop it earlier, or it will stop automatically after 10 hours."

# Start the server and capture the process
$process = Start-Process -FilePath "python3.12" -ArgumentList "-m http.server --bind 127.0.0.1" -PassThru

# Wait for 10 hours (36000 seconds)
Start-Sleep -Seconds 36000

# Stop only the HTTP server process
if (!$process.HasExited) {
    $process | Stop-Process
}