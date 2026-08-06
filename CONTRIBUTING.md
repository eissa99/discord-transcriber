# Contributing

Bug reports and pull requests are welcome.

## Setup

Use Node.js 20 or newer.

```sh
git clone https://github.com/eissa99/discord-transcriber.git
cd discord-transcriber
npm install
```

## Checks

```sh
npm run check
```

Run the demo when changing transcript output:

```sh
npm run demo
```

## Pull requests

Keep each pull request focused. Add tests for behavior changes and update the docs when the public API changes. Include a screenshot for rendering changes.

Test untrusted input when changing HTML, SVG, URLs, scripts, or the Content Security Policy.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>[optional scope]: <description>
```

Common types are `feat`, `fix`, `docs`, `test`, `refactor`, `style`, `build`, `ci`, and `chore`.

```text
feat(renderer): support poll results
fix(markdown): escape malformed mentions
docs: add contribution guide
```

By contributing, you agree that your work will use the project's [MIT License](LICENSE).
