# OCR models

`text-detection.rten` and `text-recognition.rten` are the text detection and
recognition models of [ocrs](https://github.com/robertknight/ocrs) by Robert
Knight, licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). They are
bundled unchanged, as published at `ocrs-models.s3-accelerate.amazonaws.com`
before that bucket closed in 2026.

| File | SHA-256 |
|---|---|
| text-detection.rten | f15cfb56bd02c4bf478a20343986504a1f01e1665c2b3a0ad66340f054b1b5ca |
| text-recognition.rten | e484866d4cce403175bd8d00b128feb08ab42e208de30e42cd9889d8f1735a6e |

These exact files are the ones StarBuddy's screen reader is tuned for. The
later copies on Hugging Face (`robertknight/ocrs`) are different files and
read scan signatures worse: 16 of 24 screenshots in the test corpus against
24 of 24. Run the corpus tests with `STARBUDDY_OCR_MODELS=<folder>` before
replacing them.
