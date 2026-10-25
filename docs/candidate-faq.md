# Candidate Examination FAQ

Frequently asked questions for candidates taking an online examination on Pariksha (`O-04`).

---

## 1. Before the Examination

### What devices and browsers are supported?
Pariksha supports modern desktop and laptop computers running:
- Google Chrome (latest 2 versions)
- Mozilla Firefox (latest 2 versions)
- Microsoft Edge (latest 2 versions)
- Apple Safari on macOS

*Note:* Unless your examination explicitly permits mobile devices, taking exams on phones or tablets is blocked to ensure screen stability and proctoring compliance.

### What hardware permissions are required?
If your examination specifies camera proctoring:
1. When prompted by your browser, click **Allow** to grant access to your webcam.
2. Ensure you are situated in a well-lit room with your face clearly visible.
3. No external browser extensions, plugins, or software downloads are required.

---

## 2. During the Examination

### What happens if my internet connection drops?
Pariksha is engineered with a **local-first resilient save queue** (`AC-14`):
- All your answers are immediately recorded in your browser's local memory.
- If your internet connection drops, you can continue reading and answering questions without interruption.
- The status indicator in the top header will display **Offline / Reconnecting**.
- As soon as your connection is restored, all queued responses are automatically synchronised and confirmed by the server.

### What triggers an integrity violation or warning?
Depending on your exam's rules:
- **Exiting Fullscreen:** You should remain in full-screen mode throughout the test.
- **Switching Tabs or Windows:** Leaving the examination tab or switching to another application is detected and logged.
- **Lost Camera Feed:** Covering or disconnecting your webcam will alert proctors.

*Tip:* Close all chat programs, notification banners, and browser tabs before beginning to avoid accidental violations.

### How does the examination clock work?
The exam countdown timer is synchronized with the server's authoritative clock (`AC-13`). Even if you reload your browser page or experience network jitter, the clock remains accurate. If time runs out, your completed answers are automatically submitted on your behalf.

---

## 3. Submitting and Results

### How do I submit my exam?
When you have answered all questions, click the **Submit exam** button. A summary modal will confirm:
- The total number of answered questions.
- Any questions you marked for review.
- Any unanswered items.

Click **Confirm Submit** to finalize your paper.

### How do I view my results?
Upon submission, Pariksha provides a confirmation receipt along with a unique **Result Access Code** (e.g. `res_abc123`). Keep this code safe. When your institution releases the results, you can return to the examination link, enter your code, and access your verified scorecard.
