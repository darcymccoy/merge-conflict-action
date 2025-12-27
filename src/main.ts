import * as core from '@actions/core'
import * as github from '@actions/github'
import { GitHub } from '@actions/github/lib/utils.js'

type FileChange = {
  filename: string
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged'
}

type ConflictWarning = {
  prNumber: number
  prTitle: string
  conflictingFiles: string[]
}

type RepositoryInfo = {
  octokit: InstanceType<typeof GitHub>
  owner: string
  repo: string
}

export async function run(): Promise<void> {
  try {
    const includeDrafts: boolean = core.getBooleanInput('include-drafts', { required: false })
    const postComments: boolean = core.getBooleanInput('post-comments', { required: false })

    core.debug(`Include draft PRs: ${includeDrafts}`)

    const token = core.getInput('github_token', { required: true })
    const octokit = github.getOctokit(token)
    const { owner, repo } = github.context.repo
    const repoInfo: RepositoryInfo = { octokit, owner, repo }

    const currentPR = github.context.payload.pull_request
    if (!currentPR) {
      core.setFailed('This action must be triggered by a pull_request event')
      return
    }

    core.info(`Checking PR #${currentPR.number} for potential conflicts...`)

    const currentPRChangedFiles = await getPRFiles(repoInfo, currentPR.number)
    core.info(`Current PR #${currentPR.number} modifies ${currentPRChangedFiles.length} files`)

    const { data: prs } = await octokit.rest.pulls.list({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      state: 'open',
      per_page: 100
    })

    const conflictWarnings: ConflictWarning[] = []

    for (const pr of prs) {
      if (pr.number === currentPR.number) {
        continue
      }

      if (pr.draft && !includeDrafts) {
        continue
      }

      const otherPRChangedFiles = await getPRFiles(repoInfo, pr.number)

      const conflictingFiles = findConflictingFiles(currentPRChangedFiles, otherPRChangedFiles)

      if (conflictingFiles.length > 0) {
        core.warning(`PR #${pr.number} may have conflicts: ${conflictingFiles.length} overlapping files`)

        conflictWarnings.push({
          prNumber: pr.number,
          prTitle: pr.title,
          conflictingFiles
        })
      }
    }

    if (conflictWarnings.length > 0) {
      core.setOutput('has-conflicts', 'true')
      core.setOutput('conflict-count', conflictWarnings.length)
      core.setOutput('conflicts', JSON.stringify(conflictWarnings))

      const summary = generateSummary(conflictWarnings)
      core.summary.addRaw(summary).write()

      if (postComments) {
        try {
          await postConflictComment(repoInfo, currentPR.number, conflictWarnings)
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('Resource not accessible by integration')) {
              core.warning('Insufficient permissions to post comment. Add "pull-requests: write" permission.')
            } else {
              core.warning(`Failed to post comment: ${error.message}`)
            }
          }
        }
      }

      core.info(`Found ${conflictWarnings.length} PRs with potential conflicts`)
    } else {
      core.setOutput('has-conflicts', 'false')
      core.setOutput('conflict-count', 0)
      core.info('No potential conflicts detected with other open PRs')
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

async function getPRFiles(repoInfo: RepositoryInfo, prNumber: number): Promise<FileChange[]> {
  const files: FileChange[] = []
  let page = 1
  const perPage = 100

  while (true) {
    const { data } = await repoInfo.octokit.rest.pulls.listFiles({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      pull_number: prNumber,
      per_page: perPage,
      page
    })

    files.push(
      ...data.map((file) => ({
        filename: file.filename,
        status: file.status
      }))
    )

    if (data.length < perPage) {
      break
    }

    page++
  }
  return files
}

function findConflictingFiles(currentPRFiles: FileChange[], otherPRFiles: FileChange[]): string[] {
  const currentModifiedFiles = new Set(
    currentPRFiles.filter((f) => f.status === 'modified' || f.status === 'removed').map((f) => f.filename)
  )

  const otherModifiedFiles = otherPRFiles.filter(
    (f) => (f.status === 'modified' || f.status === 'removed') && currentModifiedFiles.has(f.filename)
  )

  return otherModifiedFiles.map((f) => f.filename)
}

function generateSummary(warnings: ConflictWarning[]): string {
  let summary = '## Potential Merge Conflicts Detected\n\n'
  summary += 'The following PRs modify the same files and may have conflicts when this PR is merged:\n\n'

  for (const warning of warnings) {
    summary += `### PR #${warning.prNumber}: ${warning.prTitle}\n`
    summary += `**Overlapping files (${warning.conflictingFiles.length}):**\n`

    for (const file of warning.conflictingFiles.slice(0, 10)) {
      summary += `- \`${file}\`\n`
    }

    if (warning.conflictingFiles.length > 10) {
      summary += `- ... and ${warning.conflictingFiles.length - 10} more\n`
    }

    summary += '\n'
  }

  summary +=
    '> **Note:** This is a heuristic check based on file overlap. Actual merge conflicts may or may not occur.\n'

  return summary
}

async function postConflictComment(
  repoInfo: RepositoryInfo,
  prNumber: number,
  warnings: ConflictWarning[]
): Promise<void> {
  const summary = generateSummary(warnings)

  await repoInfo.octokit.rest.issues.createComment({
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    issue_number: prNumber,
    body: summary
  })

  core.info('Posted conflict warning comment to PR')
}
