$json = [Console]::In.ReadToEnd() | ConvertFrom-Json
$cmd = if ($json.tool_input.command) { $json.tool_input.command } else { '' }

# Block genuinely destructive patterns — everything else is auto-approved
$dangerous = @(
    'rm\s+-rf\s+/',
    'git\s+push\s+.*--force',
    'git\s+reset\s+--hard',
    'Remove-Item.*-Recurse.*-Force\s+[A-Z]:\\(?!dev\\doope)',
    'format\s+[a-z]:',
    'DROP\s+TABLE',
    'TRUNCATE\s+TABLE'
)

$is_dangerous = $dangerous | Where-Object { $cmd -match $_ }

if (-not $is_dangerous) {
    Write-Output '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
}
