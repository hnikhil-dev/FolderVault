# Contributing to FolderVault

Thank you for your interest in contributing to FolderVault. This document explains the recommended workflow for reporting issues, proposing changes, and submitting pull requests.

## tl;dr — quick guide
- Fork the repository.
- Create a feature branch (git checkout -b feature/my-change).
- Run the tests and the app locally.
- Open a pull request with a clear description and link to any relevant issue.

## Development setup
1. Install dependencies:

```powershell
npm ci
```

2. Run the app locally (Dev mode):

```powershell
npm start
```

3. Run the non-GUI smoke tests:

```powershell
npm run test-harness
```

4. Build an unsigned portable artifact (for manual testing on Windows):

```powershell
npm run build
```

## Branching and commits
- Use feature branches named like `feature/desc` or `fix/desc`.
- Keep commits focused and well-described. Use present tense and explain the why when helpful.

## Pull requests
- Target the `main` branch for production-ready changes.
- Include a short summary of the change, why it is needed, and any security or migration notes.
- If the change affects cryptography, include tests and a brief rationale for the chosen parameters.

## Tests & validation
- The repository includes a non-GUI `test_harness.js` that exercises core crypto, file I/O, secure-delete, and cancellation paths. Run it before opening a PR.
- If you add logic that affects the main process or crypto, add test cases to protect against regressions.

## Style and linting
- There is no enforced linter in this repository by default. Follow existing project style for JavaScript and CSS.

## Security & responsible disclosure
- If you find a security vulnerability, please do not open a public issue. Instead, contact the repository owner directly (via the email listed in `package.json`) so the issue can be handled privately.

## Code of conduct
Contributions should be respectful and professional. If you'd like, I can add a formal CODE_OF_CONDUCT.md to the repo.

Thanks again — contributions, issues, and questions are very welcome.
