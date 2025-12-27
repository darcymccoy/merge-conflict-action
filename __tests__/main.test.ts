/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * To mock dependencies in ESM, you can create fixtures that export mock
 * functions and objects. For example, the core module is mocked in this test,
 * so that the actual '@actions/core' module is not imported.
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import * as github from '../__fixtures__/github.js'

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/github', () => github)

const { run } = await import('../src/main.js')

describe('Merge Conflict Detection Action', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('run', () => {
    it('should fail when not triggered by a pull request', async () => {
      github.context.payload = {}
      core.getInput.mockReturnValue('fake-token')
      core.getBooleanInput.mockReturnValue(false)

      await run()

      expect(core.setFailed).toHaveBeenCalledWith('This action must be triggered by a pull_request event')
    })

    it('should detect no conflicts when PRs modify different files', async () => {
      const mockOctokit = setupMockOctokit()
      github.context.payload = { pull_request: { number: 1 } }
      github.context.repo = { owner: 'test-owner', repo: 'test-repo' }
      github.getOctokit.mockReturnValue(mockOctokit)
      core.getInput.mockReturnValue('fake-token')
      core.getBooleanInput.mockReturnValue(false)

      // Mock current PR files
      mockOctokit.rest.pulls.listFiles.mockResolvedValueOnce({
        data: [
          { filename: 'file1.ts', status: 'modified' },
          { filename: 'file2.ts', status: 'added' }
        ]
      })

      // Mock other PR list
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [
          { number: 1, draft: false, title: 'Current PR' },
          { number: 2, draft: false, title: 'Other PR' }
        ]
      })

      // Mock other PR files (different files)
      mockOctokit.rest.pulls.listFiles.mockResolvedValueOnce({
        data: [
          { filename: 'file3.ts', status: 'modified' },
          { filename: 'file4.ts', status: 'added' }
        ]
      })

      await run()

      expect(core.setOutput).toHaveBeenCalledWith('has-conflicts', 'false')
      expect(core.setOutput).toHaveBeenCalledWith('conflict-count', 0)
      expect(core.info).toHaveBeenCalledWith('No potential conflicts detected with other open PRs')
    })

    it('should warn about potential conflicts when PRs modify the same files', async () => {
      const mockOctokit = setupMockOctokit()
      github.context.payload = { pull_request: { number: 1 } }
      github.context.repo = { owner: 'test-owner', repo: 'test-repo' }
      github.getOctokit.mockReturnValue(mockOctokit)
      core.getInput.mockReturnValue('fake-token')
      core.getBooleanInput.mockReturnValue(false)

      // Mock current PR files
      mockOctokit.rest.pulls.listFiles.mockResolvedValueOnce({
        data: [
          { filename: 'shared.ts', status: 'modified' },
          { filename: 'file2.ts', status: 'added' }
        ]
      })

      // Mock other PR list
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [
          { number: 1, draft: false, title: 'Current PR' },
          { number: 2, draft: false, title: 'Conflicting PR' }
        ]
      })

      // Mock other PR files (same file modified)
      mockOctokit.rest.pulls.listFiles.mockResolvedValueOnce({
        data: [
          { filename: 'shared.ts', status: 'modified' },
          { filename: 'file4.ts', status: 'added' }
        ]
      })

      await run()

      expect(core.setOutput).toHaveBeenCalledWith('has-conflicts', 'true')
      expect(core.setOutput).toHaveBeenCalledWith('conflict-count', 1)
      expect(core.warning).toHaveBeenCalledWith('PR #2 may have conflicts: 1 overlapping files')
      expect(core.summary.addRaw).toHaveBeenCalled()
    })

    it('should skip draft PRs when include-drafts is false', async () => {
      const mockOctokit = setupMockOctokit()
      github.context.payload = { pull_request: { number: 1 } }
      github.context.repo = { owner: 'test-owner', repo: 'test-repo' }
      github.getOctokit.mockReturnValue(mockOctokit)
      core.getInput.mockReturnValue('fake-token')
      core.getBooleanInput.mockReturnValue(false)

      // Mock current PR files
      mockOctokit.rest.pulls.listFiles.mockResolvedValueOnce({
        data: [{ filename: 'shared.ts', status: 'modified' }]
      })

      // Mock other PR list with a draft
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [
          { number: 1, draft: false, title: 'Current PR' },
          { number: 2, draft: true, title: 'Draft PR' }
        ]
      })

      await run()

      expect(mockOctokit.rest.pulls.listFiles).toHaveBeenCalledTimes(1)
      expect(core.setOutput).toHaveBeenCalledWith('has-conflicts', 'false')
    })

    it('should check draft PRs when include-drafts is true', async () => {
      const mockOctokit = setupMockOctokit()
      github.context.payload = { pull_request: { number: 1 } }
      github.context.repo = { owner: 'test-owner', repo: 'test-repo' }
      github.getOctokit.mockReturnValue(mockOctokit)
      core.getInput.mockReturnValue('fake-token')
      core.getBooleanInput.mockImplementation((name) => name === 'include-drafts')

      // Mock current PR files
      mockOctokit.rest.pulls.listFiles.mockResolvedValueOnce({
        data: [{ filename: 'shared.ts', status: 'modified' }]
      })

      // Mock other PR list with a draft
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [
          { number: 1, draft: false, title: 'Current PR' },
          { number: 2, draft: true, title: 'Draft PR' }
        ]
      })

      // Mock draft PR files (same file)
      mockOctokit.rest.pulls.listFiles.mockResolvedValueOnce({
        data: [{ filename: 'shared.ts', status: 'modified' }]
      })

      await run()

      expect(mockOctokit.rest.pulls.listFiles).toHaveBeenCalledTimes(2)
      expect(core.setOutput).toHaveBeenCalledWith('has-conflicts', 'true')
    })

    it('should post comments when post-comments is true', async () => {
      const mockOctokit = setupMockOctokit()
      github.context.payload = { pull_request: { number: 1 } }
      github.context.repo = { owner: 'test-owner', repo: 'test-repo' }
      github.getOctokit.mockReturnValue(mockOctokit)
      core.getInput.mockReturnValue('fake-token')
      core.getBooleanInput.mockImplementation((name) => name === 'post-comments')

      // Mock current PR files
      mockOctokit.rest.pulls.listFiles.mockResolvedValueOnce({
        data: [{ filename: 'shared.ts', status: 'modified' }]
      })

      // Mock other PR list
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [
          { number: 1, draft: false, title: 'Current PR' },
          { number: 2, draft: false, title: 'Conflicting PR' }
        ]
      })

      // Mock other PR files
      mockOctokit.rest.pulls.listFiles.mockResolvedValueOnce({
        data: [{ filename: 'shared.ts', status: 'modified' }]
      })

      mockOctokit.rest.issues.createComment.mockResolvedValue({ data: {} })

      await run()

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 1,
        body: expect.stringContaining('Potential Merge Conflicts Detected')
      })
    })

    it('should handle multiple conflicting PRs', async () => {
      const mockOctokit = setupMockOctokit()
      github.context.payload = { pull_request: { number: 1 } }
      github.context.repo = { owner: 'test-owner', repo: 'test-repo' }
      github.getOctokit.mockReturnValue(mockOctokit)
      core.getInput.mockReturnValue('fake-token')
      core.getBooleanInput.mockReturnValue(false)

      // Mock current PR files
      mockOctokit.rest.pulls.listFiles.mockResolvedValueOnce({
        data: [
          { filename: 'file1.ts', status: 'modified' },
          { filename: 'file2.ts', status: 'modified' }
        ]
      })

      // Mock other PR list
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [
          { number: 1, draft: false, title: 'Current PR' },
          { number: 2, draft: false, title: 'Conflicting PR 1' },
          { number: 3, draft: false, title: 'Conflicting PR 2' }
        ]
      })

      // Mock PR 2 files (conflicts with file1.ts)
      mockOctokit.rest.pulls.listFiles.mockResolvedValueOnce({
        data: [{ filename: 'file1.ts', status: 'modified' }]
      })

      // Mock PR 3 files (conflicts with file2.ts)
      mockOctokit.rest.pulls.listFiles.mockResolvedValueOnce({
        data: [{ filename: 'file2.ts', status: 'modified' }]
      })

      await run()

      expect(core.setOutput).toHaveBeenCalledWith('has-conflicts', 'true')
      expect(core.setOutput).toHaveBeenCalledWith('conflict-count', 2)
      expect(core.warning).toHaveBeenCalledTimes(2)
    })

    it('should handle pagination of PR files', async () => {
      const mockOctokit = setupMockOctokit()
      github.context.payload = { pull_request: { number: 1 } }
      github.context.repo = { owner: 'test-owner', repo: 'test-repo' }
      github.getOctokit.mockReturnValue(mockOctokit)
      core.getInput.mockReturnValue('fake-token')
      core.getBooleanInput.mockReturnValue(false)

      // Mock current PR files with pagination (100 files per page)
      const page1Files = Array.from({ length: 100 }, (_, i) => ({
        filename: `file${i}.ts`,
        status: 'modified'
      }))
      const page2Files = [{ filename: 'file100.ts', status: 'modified' }]

      mockOctokit.rest.pulls.listFiles
        .mockResolvedValueOnce({ data: page1Files })
        .mockResolvedValueOnce({ data: page2Files })

      // Mock other PR list (no other PRs to simplify)
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [{ number: 1, draft: false, title: 'Current PR' }]
      })

      await run()

      expect(mockOctokit.rest.pulls.listFiles).toHaveBeenCalledTimes(2)
      expect(core.info).toHaveBeenCalledWith('Current PR #1 modifies 101 files')
    })

    it('should handle API errors gracefully', async () => {
      const mockOctokit = setupMockOctokit()
      github.context.payload = { pull_request: { number: 1 } }
      github.context.repo = { owner: 'test-owner', repo: 'test-repo' }
      github.getOctokit.mockReturnValue(mockOctokit)
      core.getInput.mockReturnValue('fake-token')
      core.getBooleanInput.mockReturnValue(false)

      // Mock API error
      mockOctokit.rest.pulls.listFiles.mockRejectedValue(new Error('API rate limit exceeded'))

      await run()

      expect(core.setFailed).toHaveBeenCalledWith('API rate limit exceeded')
    })
  })
})

function setupMockOctokit() {
  return {
    rest: {
      pulls: {
        list: jest.fn(),
        listFiles: jest.fn()
      },
      issues: {
        createComment: jest.fn()
      }
    }
  }
}
