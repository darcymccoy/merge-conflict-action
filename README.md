# Merge Conflict GitHub Action

A GitHub action that can detect and warn if merging a pull request will create merge conflicts in another PR. Currently
this uses a heuristic check based on file overlap.

## Usage

### Create a `.github/workflows/merge-conflict-action.yml` file

Add the following to the file:

```yaml
name: PR Conflict Detection

on:
  pull_request:
    branches:
      - main

permissions:
  contents: read
  pull-requests: write # Required for posting comments

jobs:
  check-conflicts:
    name: Check for Merge Conflicts
    runs-on: ubuntu-latest

    steps:
      - name: Check for conflicts with other PRs
        uses: darcymccoy/merge-conflict-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          include-drafts: false
          post-comments: true
```

### Or, add the following to a pre-existing workflow file under the job section:

```yaml
- name: Check for conflicts with other PRs
  uses: darcymccoy/merge-conflict-action@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    include-drafts: false
    post-comments: true
```

> **Note:** To enable the PR comment feature (`post-comments: true`), you must add the `pull-requests: write` permission
> to your workflow.

### Inputs

| Input            | Description                                     | Required | Default |
| ---------------- | ----------------------------------------------- | -------- | ------- |
| `github_token`   | GitHub token for API access                     | Yes      | N/A     |
| `include-drafts` | Include draft PRs in conflict detecting         | No       | `false` |
| `post-comments`  | Post a comment on the PR with conflict warnings | No       | `false` |

### Outputs

| Output           | Description                                                   |
| ---------------- | ------------------------------------------------------------- |
| `has-conflicts`  | Whether potential conflicts were detected (`true` or `false`) |
| `conflict-count` | Number of PRs with potential conflicts                        |
| `conflicts`      | JSON array of conflict details                                |

## Getting Started

1. Clone the repository:

   ```bash
   git clone https://github.com/darcymccoy/merge-conflict-action.git
   ```

1. Install the dependencies:

   ```bash
   npm install
   ```

1. Run the tests:

   ```bash
   npm test
   ```

1. package the project for distribution:

   ```bash
   npm run bundle
   ```

## Learn More

To make your own GitHub action check out
[GitHub's documentation.](https://docs.github.com/en/actions/how-tos/create-and-publish-actions)
