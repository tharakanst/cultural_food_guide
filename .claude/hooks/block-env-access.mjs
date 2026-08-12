#!/usr/bin/env node
/**
 * PreToolUse hook — blocks agents from reading or writing .env files.
 *
 * .env holds the AI provider API key. Blocking access here means the key
 * cannot be pulled into a session transcript or overwritten by accident.
 * .env.example is deliberately allowed — it contains only empty placeholders.
 *
 * Receives the tool call as JSON on stdin. Prints a deny decision if the
 * target is a .env file; stays silent (allowing the call) otherwise.
 */

let input = ''
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  let filePath = ''
  try {
    filePath = JSON.parse(input)?.tool_input?.file_path ?? ''
  } catch {
    process.exit(0) // unparseable input is not our problem — do not block
  }

  const isEnvFile = /(^|[\\/])\.env$/.test(filePath)
  if (!isEnvFile) process.exit(0)

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Blocked: .env holds the AI provider API key and must not be read or modified by an agent. Edit it manually, and use .env.example for documenting variable names.',
      },
    }),
  )
})
