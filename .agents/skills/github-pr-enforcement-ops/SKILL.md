# GitHub Branching & PR Enforcement Skill

## 1. Non-Negotiable Core Rule
- **NEVER PUSH DIRECTLY TO `main`**.
- Direct pushes to `main` are strictly blocked by GitHub Branch Protection rules (`enforce_admins: true`).
- **PULL REQUESTS ARE THE ONLY WAY TO MERGE CODE INTO `main`**.

## 2. Mandatory Branch Naming Conventions
Always create feature/fix branches with descriptive names prior to making changes:
- `feat/feature-name` (e.g. `feat/user-friendly-error-catalog`)
- `fix/bug-name` (e.g. `fix/null-summary-guard`)
- `test/test-suite-name` (e.g. `test/playwright-emulator-e2e`)

## 3. Pull Request Workflow
1. Create a feature branch:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Commit changes and push branch to origin:
   ```bash
   git add .
   git commit -m "feat(scope): concise description"
   git push origin feat/your-feature-name
   ```
3. Open a Pull Request using `gh`:
   ```bash
   gh pr create --title "feat(scope): title" --body "## Summary\n- Detailed changes..." --head feat/your-feature-name --base main
   ```
4. Verify monorepo build passes before merging (`npx nx run-many -t build`).
