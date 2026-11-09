# Changelog

## Unreleased

- `estimateTokens`, which the history window (`withinBudget`) and a long turn's trimming (`trimOldResults`) both count with, counts a file or picture part by its size instead of by the JSON that writes out its bytes, several characters a byte: a picture costs 1,000 tokens, and a file a token per four bytes, or 1,000 when its size is unknown (a link), whether its data is a Buffer, a typed array, base64 text or a data URL. An attached file of about 80 KB used to outweigh a 128k-token model's whole history, so every earlier message was dropped, and an attached picture made a turn leave out its older tool results.
