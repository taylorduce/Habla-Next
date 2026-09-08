# HablaNext

A phone-friendly Spanish speaking companion. It listens through the phone or AirPods microphone, shows likely **next words** with English glosses, then shows **possible sentence endings**, and slowly personalizes both from the phrases you actually say.

This is a **web app you can pin to the Home Screen**, not an App Store binary. I cannot publish a native iOS/Android app to your phone from here.

## Put it on your iPhone

1. Copy the `habla-next` folder to iCloud Drive, Dropbox, GitHub Pages, Netlify, or any static host.
2. Open `index.html` in **Safari** (required for speech recognition on iOS).
3. Tap Share → **Add to Home Screen**.
4. Open HablaNext, tap **Listen**, allow the microphone.

If AirPods are connected and set as the iPhone microphone, Safari uses them automatically. There is no separate AirPods API in the browser.

## Use it while speaking

- Leave the app in the foreground.
- Speak naturally in Spanish.
- Look at the word chips when you stall. Each chip is a Spanish word with an English translation under it.
- The lower list is fuller sentence outcomes from the same prefix.
- Tap a word or a sentence to lock it in and keep predicting from there.

## How learning works

On every finalized utterance the app updates an on-device model:

- word → next-word counts (your bigrams)
- two-word → next-word counts (your trigrams)
- full phrases you have said

Those personal counts are blended with a built-in conversational Spanish model. After enough sessions, chips tagged **from your speech** should start looking like *your* Spanish, not textbook Spanish.

Data never leaves the device unless you tap **Export learning**.

## Honest limits

| Wanted | What this build does |
|---|---|
| Native App Store app | Not possible from this chat. This is a PWA / web page. |
| Always-on listening with the phone locked | iOS will not allow that for a web page. Keep the screen on. |
| Hear you while another app is open | No. Safari suspends recognition in the background. |
| Neural model trained only on your voice | Too heavy for a local web page. This uses n-grams + your phrase memory. |
| Perfect AirPods-only routing | Uses whatever mic iOS currently exposes to Safari. |

A production native version would use Apple Speech / SpeechAnalyzer on device, an on-device language model for next-word scoring, and optional iCloud sync of the personal n-gram store. That is a real iOS project, not a single-file prototype.

## Local preview

Open `index.html` in Chrome or Safari on a computer with a microphone to try the UI before putting it on a phone.
