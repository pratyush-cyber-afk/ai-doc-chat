---
id: doc-06-telemetry-anomaly-report
title: "Telemetry Anomaly Report TA-1649-07"
access_level: survey
doc_type: technical_report
date: 2391-03-10
---

# Telemetry Anomaly Report TA-1649-07

**Vessel:** CCV *Meridian Drift*
**System / Body:** Kepler-1649 / Asphodel (moon of Kepler-1649d)
**Prepared by:** Dr. Mara Okafor, Science Officer
**Reviewed by:** Captain Idris Valen
**Date filed:** 10 March 2391
**Status:** OPEN. Escalated to Deep-Space Survey HQ

## 1. Summary

At 04:12 ship time on **9 March 2391**, during a routine ice-penetrating radar pass over survey grid **AS-14**, the *Meridian Drift* passive sensor array recorded a low-power radio emission originating from beneath Asphodel's ice shelf. The emission repeats at a fixed interval and shows internal structure inconsistent with any known natural source.

This report documents the detection, initial analysis and recommended next steps.

## 2. Detection data

| Parameter | Value |
|---|---|
| First detection | 2391-03-09, 04:12 ship time |
| Source location | Grid AS-14, southern ice shelf |
| Estimated source depth | ~2.1 km below surface |
| Carrier frequency | 1420.4 MHz (hydrogen line) |
| Repeat interval | 47.3 seconds (±0.001 s) |
| Signal strength | −142 dBm at orbit |
| Detections to date | 1,826 consecutive cycles, no gaps |

Radar returns show a roughly spherical cavity approximately **340 metres** in diameter at the source depth. The cavity walls return an unusually uniform signature, suggesting a smooth or non-ice surface.

## 3. Analysis

**3.1 Natural explanations considered and rejected**

- *Cryovolcanic or tidal activity:* would not produce a stable 47.3 s period across tidal cycles.
- *Pulsar or background source:* triangulation across three orbital passes confirms the source is fixed to Asphodel's surface coordinates.
- *Instrument fault:* the signal was independently confirmed by the backup array and by the shuttle *Charon's Obol*'s onboard receiver.

**3.2 Signal structure**

Each 47.3 s cycle contains a sequence of pulse groups. The group sizes follow the series **2, 3, 5, 7, 11, 13, 17, 19, 23**: the first nine prime numbers. A secondary, much denser data layer sits underneath the pulse groups and has not yet been decoded.

The use of the hydrogen line and a prime-number sequence strongly suggests the signal is **artificial and intended to be recognised as such**.

## 4. Risk assessment

- No direct physical hazard identified at orbital distance.
- The source's origin, age and purpose are unknown.
- Behaviour under active interaction (e.g. a transmitted response) is **unknown**.

## 5. Recommendations

1. Maintain passive monitoring only. **No transmissions toward the source** until guidance is received from Survey HQ.
2. Prioritise decoding of the secondary data layer (Dr. Okafor).
3. Suspend landing planning for grid AS-14 pending further review.
4. Share findings with all mission crew to maintain situational awareness.

## 6. Command note

> *Recommendation 4 overruled by Corporate Liaison E. Vasquez under Policy CCP-7.4. Findings restricted to science and command staff. Report forwarded to Director C. Wren via Lethe-9.*
> I. Valen, Captain

## Appendix A: Raw pulse group timing (cycle 1)

```
t+00.00s  ||
t+02.10s  |||
t+04.90s  |||||
t+08.40s  |||||||
t+13.30s  |||||||||||
t+19.60s  |||||||||||||
t+27.30s  |||||||||||||||||
t+35.70s  |||||||||||||||||||
t+44.80s  |||||||||||||||||||||||
[dense layer: 2.5 s, undecoded]
```
