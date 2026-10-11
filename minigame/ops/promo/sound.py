import json, os, wave
import numpy as np

W = os.environ.get('PROMO_DIR', '/tmp/claude-0/promo')
SR = 48000
DUR = 15.0
N = int(SR * DUR)
rng = np.random.default_rng(7)
t_all = np.arange(N) / SR

def env_adsr(n, a, d, s, r, sustain_len):
    a, d, r = int(a * SR), int(d * SR), int(r * SR)
    hold = max(0, int(sustain_len * SR))
    e = np.concatenate([np.linspace(0, 1, max(a, 1)), np.linspace(1, s, max(d, 1)), np.full(hold, s), np.linspace(s, 0, max(r, 1))])
    return e[:n] if len(e) >= n else np.pad(e, (0, n - len(e)))

def place(buf, sig, at):
    i = int(at * SR)
    j = min(len(buf), i + len(sig))
    if i < len(buf):
        buf[i:j] += sig[: j - i]

def stft_filter(x, gain_fn, n=2048, hop=512):
    """time-varying spectral gain: gain_fn(time_s, freqs) -> gains"""
    win = np.hanning(n)
    out = np.zeros(len(x) + n)
    norm = np.zeros(len(x) + n)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    xp = np.pad(x, (0, n))
    for s in range(0, len(x), hop):
        seg = xp[s:s + n] * win
        X = np.fft.rfft(seg) * gain_fn((s + n / 2) / SR, freqs)
        y = np.fft.irfft(X, n) * win
        out[s:s + n] += y
        norm[s:s + n] += win ** 2
    norm[norm < 1e-6] = 1
    return (out / norm)[: len(x)]

def lowpass(x, fc):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + (f / fc) ** 4)
    return np.fft.irfft(X, len(x))

def midi(m):
    return 440 * 2 ** ((m - 69) / 12)

# ---------------- music bed: soft pad + plucks, 100 bpm ----------------
L = np.zeros(N); R = np.zeros(N)
BEAT = 0.6
chords = [[60, 67, 74, 76, 83], [57, 64, 71, 72, 79], [53, 60, 67, 69, 76], [55, 62, 69, 71, 78]]  # Cmaj9, Am9, Fmaj9, G6/9
CH = 3.6
for ci in range(5):
    start = ci * CH
    if start >= DUR: break
    notes = chords[ci % 4]
    length = min(CH + 1.2, DUR - start)
    n = int(length * SR)
    tt = np.arange(n) / SR
    e = env_adsr(n, 0.9, 0.6, 0.75, 1.2, length - 2.7)
    for k, m in enumerate(notes):
        f = midi(m)
        for det, pan in ((-0.12, 0.3), (0.12, 0.7)):
            ff = f * 2 ** (det / 12 / 10)
            s = (np.sin(2 * np.pi * ff * tt) + 0.25 * np.sin(2 * np.pi * 2 * ff * tt + 0.3)) * e * 0.035
            place(L, s * (1 - pan), start); place(R, s * pan, start)
for ci in range(5):
    start = ci * CH
    if start >= DUR: break
    length = min(CH + 0.8, DUR - start); n = int(length * SR); tt = np.arange(n) / SR
    f = midi(chords[ci % 4][0] - 12)
    b = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2 * f * tt)) * env_adsr(n, 0.4, 0.5, 0.6, 0.8, length - 1.7) * 0.05
    place(L, b, start); place(R, b, start)
# plucks on an arpeggio, start after the intro title
arp_pat = [0, 2, 4, 3, 1, 3, 4, 2]
t0 = 1.8
i = 0
while True:
    at = t0 + i * BEAT / 2
    if at > 12.3: break
    ci = int(at // CH) % 4
    m = chords[ci][arp_pat[i % 8]] + 12
    f = midi(m)
    n = int(0.9 * SR); tt = np.arange(n) / SR
    s = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * 2.01 * f * tt) * np.exp(-tt * 18)) * np.exp(-tt * 5.5) * 0.05
    s *= np.minimum(1, tt / 0.004)
    pan = 0.35 + 0.3 * ((i * 3) % 5) / 4
    vel = 1.0 if i % 2 == 0 else 0.7
    place(L, s * (1 - pan) * vel, at); place(R, s * pan * vel, at)
    i += 1
music = np.stack([L, R])
# gentle overall shape: in from 0, duck under the end sting, fade at the end
shape = np.clip(t_all / 1.2, 0, 1) * np.clip((DUR - t_all) / 1.6, 0, 1)
music *= shape
music = np.stack([lowpass(music[0], 8000), lowpass(music[1], 8000)])

# ---------------- sfx ----------------
S = np.zeros((2, N))

def add(sig, at, pan=0.5, g=1.0):
    place(S[0], sig * (1 - pan) * g * 2, at); place(S[1], sig * pan * g * 2, at)

def whoosh(dur=0.7, f0=400, f1=4000, g=0.12):
    n = int(dur * SR); x = rng.standard_normal(n)
    def gain(ts, fr):
        k = ts / dur
        fc = f0 * (f1 / f0) ** k
        return np.exp(-((np.log(fr + 1) - np.log(fc)) ** 2) / (2 * 0.35 ** 2))
    y = stft_filter(x, gain, 1024, 256)
    tt = np.arange(n) / SR
    e = np.sin(np.pi * np.clip(tt / dur, 0, 1)) ** 2
    return y * e * g

def blip(f=1800, dur=0.12, g=0.12):
    n = int(dur * SR); tt = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * tt) * np.exp(-tt * 45) + 0.4 * np.sin(2 * np.pi * f * 1.5 * tt) * np.exp(-tt * 70)
    return s * np.minimum(1, tt / 0.0015) * g

def tick(g=0.08):
    n = int(0.03 * SR); x = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * 300)
    return lowpass(np.pad(x, (0, 200)), 6000)[:n] * g

def bell(freqs, dur=2.0, g=0.12):
    n = int(dur * SR); tt = np.arange(n) / SR
    s = np.zeros(n)
    for k, (f, a, d) in enumerate(freqs):
        s += a * np.sin(2 * np.pi * f * tt + k) * np.exp(-tt * d)
    return s * np.minimum(1, tt / 0.002) * g

def water(dur, g=0.05):
    n = int(dur * SR); x = rng.standard_normal(n)
    # bubbly: band around 700-2500 Hz, amplitude modulated by random bursts
    def gain(ts, fr):
        return np.exp(-((np.log(fr + 1) - np.log(1300)) ** 2) / (2 * 0.5 ** 2))
    y = stft_filter(x, gain, 1024, 256)
    tt = np.arange(n) / SR
    mod = 0.55 + 0.45 * np.sin(2 * np.pi * 7 * tt + 2 * np.sin(2 * np.pi * 1.3 * tt))
    e = np.clip(tt / 0.25, 0, 1) * np.clip((dur - tt) / 0.35, 0, 1)
    # a few droplets
    for _ in range(int(dur * 9)):
        at = rng.uniform(0.1, dur - 0.1); f = rng.uniform(900, 2200)
        m = int(0.05 * SR); u = np.arange(m) / SR
        d = np.sin(2 * np.pi * (f + 2500 * u) * u) * np.exp(-u * 90) * 0.5
        i0 = int(at * SR); y[i0:i0 + m] += d[: len(y[i0:i0 + m])]
    return y * mod * e * g

def swell(dur=1.2, g=0.08):
    n = int(dur * SR); x = rng.standard_normal(n)
    def gain(ts, fr):
        k = ts / dur
        fc = 300 * (6000 / 300) ** k
        return 1 / np.sqrt(1 + (fr / fc) ** 4)
    y = stft_filter(x, gain, 1024, 256)
    tt = np.arange(n) / SR
    return y * (tt / dur) ** 2 * np.clip((dur - tt) / 0.08, 0, 1) * g

E = json.load(open(W + '/events.json'))
# timings in video seconds (match compose.html MAP / CAM)
add(swell(0.85, 0.07), 0.0)
add(bell([(midi(72), 1, 3.5), (midi(79), .6, 4), (midi(84), .35, 5)], 2.4, 0.06), 0.82)      # title lands
add(whoosh(0.8, 250, 3500, 0.10), 1.25, 0.5)                                               # phone rises
add(tick(0.10), 2.55, 0.5)                                                                  # grab block
for at, pan in ((2.95, .4), (4.55, .6), (6.8, .45), (8.75, .55), (10.3, .5)):              # camera moves
    add(whoosh(0.55, 500, 2500, 0.05), at - 0.15, pan)
add(water(1.75, 0.05), 3.75, 0.62)                                                          # overflow (fast-forward)
add(bell([(midi(88), 1, 2.6), (midi(95), .5, 3.2), (midi(100), .25, 4)], 2.2, 0.10), 5.5, 0.5)  # F浮 = G排
add(blip(1600, g=0.10), 6.42, 0.5)                                                          # tab 02
add(tick(0.08), 6.72, 0.5)                                                                  # drag
add(blip(1900, g=0.10), 8.6, 0.42)                                                          # brine
add(bell([(midi(84), 1, 3), (midi(91), .4, 4)], 1.6, 0.05), 8.7, 0.6)                      # F浮 grows
add(blip(1600, g=0.10), 9.9, 0.6)                                                           # tab 03
add(blip(1250, g=0.12), 10.3, 0.5)                                                          # 松手
n = int(0.5 * SR); u = np.arange(n) / SR                                                    # plop into water
add(np.sin(2 * np.pi * (180 + 900 * np.exp(-u * 30)) * u) * np.exp(-u * 12) * 0.10, 10.45, 0.5)
add(water(0.6, 0.03), 10.5, 0.5)
add(bell([(midi(84), 1, 3), (midi(88), .6, 3.4), (midi(91), .4, 4)], 2.0, 0.07), 11.0, 0.5)  # floats
add(whoosh(0.7, 3000, 300, 0.07), 11.95, 0.5)                                               # phone shrinks
add(bell([(midi(60), 1, 1.6), (midi(67), .7, 1.8), (midi(76), .5, 2.2), (midi(84), .35, 2.6)], 2.6, 0.11), 12.5, 0.5)  # end sting
add(bell([(midi(96), .5, 4), (midi(103), .3, 5)], 2.0, 0.05), 13.2, 0.55)                   # shimmer on Flag bar

mix = music * 0.9 + S
# soft limiter and normalise
mix = np.tanh(mix * 1.6) / 1.6
mix /= np.max(np.abs(mix)) / 0.89
out = (mix.T * 32767).astype(np.int16)
with wave.open(W + '/day01-sound.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(out.tobytes())
print('ok', out.shape)
