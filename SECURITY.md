# Security policy

Pariksha handles candidate personal data and exam integrity, so we take security reports seriously.

## Supported versions

Until v1.0, only the latest release receives security fixes.

| Version | Supported |
| --- | --- |
| latest pre-release | Yes |
| older pre-releases | No |

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub: go to the **Security** tab of this repository and choose **Report a vulnerability**. If that is unavailable, email the maintainers listed in [MAINTAINERS.md](MAINTAINERS.md).

Please include:

- the affected component and version or commit
- steps to reproduce, or a proof of concept
- the impact, for example reading answer keys, viewing another workspace's data, or bypassing proctoring checks on the server

## What to expect

| Step | Target time |
| --- | --- |
| Acknowledgement | 3 working days |
| Initial assessment and severity | 7 working days |
| Fix released for high or critical issues | 14 days |

We will credit reporters in the release notes unless they prefer to stay anonymous.

## Scope notes

- Browser-side proctoring signals (fullscreen, tab switching, camera) are deterrents by design. Ways to evade them in the browser are known limits, not vulnerabilities. Report them if they let someone change a result on the server.
- Answer keys, scoring, timing and permissions are enforced on the server. Any way to read or change them from a candidate session **is** a vulnerability.
