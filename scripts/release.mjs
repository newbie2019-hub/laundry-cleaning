#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'

const [,, bump = 'patch'] = process.argv

if (!['major', 'minor', 'patch'].includes(bump)) {
  console.error(`Usage: npm run release [major|minor|patch]`)
  console.error(`  major  0.1.0 → 1.0.0`)
  console.error(`  minor  0.1.0 → 0.2.0`)
  console.error(`  patch  0.1.0 → 0.1.1  (default)`)
  process.exit(1)
}

const confPath = 'src-tauri/tauri.conf.json'
const conf = JSON.parse(readFileSync(confPath, 'utf8'))
const [major, minor, patch] = conf.version.split('.').map(Number)

const next =
  bump === 'major' ? `${major + 1}.0.0`
  : bump === 'minor' ? `${major}.${minor + 1}.0`
  : `${major}.${minor}.${patch + 1}`

conf.version = next
writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n')

console.log(`\n  Bumping version: ${conf.version.replace(next, `${major}.${minor}.${patch}`)} → ${next}\n`)

try {
  execSync('git diff --quiet HEAD', { stdio: 'ignore' })
} catch {
  // uncommitted changes exist — that's fine, we'll commit the version bump below
}

execSync(`git add ${confPath}`, { stdio: 'inherit' })
execSync(`git commit -m "chore: release v${next}"`, { stdio: 'inherit' })
execSync(`git tag v${next}`, { stdio: 'inherit' })
execSync(`git push origin HEAD --tags`, { stdio: 'inherit' })

console.log(`\n  ✓ Released v${next}`)
console.log(`  → GitHub Actions is now building the installers.`)
console.log(`  → Once done, publish the draft release at:`)
console.log(`    https://github.com/newbie2019-hub/laundry-cleaning/releases\n`)
