#!/usr/bin/env node
/**
 * PostToolUse hook — formats a file with Prettier after it is written or edited.
 *
 * Keeps four contributors' diffs free of style churn. Fails silently when
 * Prettier is not installed yet, so the hook never blocks work.
 *
 * Receives the tool call as JSON on stdin.
 */

import { spawnSync } from 'node:child_process'

let input = ''
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  let filePath = ''
  try {
    const payload = JSON.parse(input)
    filePath = payload?.tool_response?.filePath ?? payload?.tool_input?.file_path ?? ''
  } catch {
    process.exit(0)
  }

  if (!filePath) process.exit(0)
  if (!/\.(js|jsx|ts|tsx|json|css|md)$/.test(filePath)) process.exit(0)

  spawnSync('npx', ['--no-install', 'prettier', '--write', '--ignore-unknown', filePath], {
    stdio: 'ignore',
    shell: true,
  })

  process.exit(0)
})
