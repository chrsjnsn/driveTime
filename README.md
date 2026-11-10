# driveTime

Is driving faster worth it? driveTime compares, for the same car on the same trip, how much time each extra mph saves against what it costs in gas and crash risk, on the interstate, in stop-and-go city traffic, or a mix of both.

It answers one question per speed: **how many dollars am I paying for each hour I save?** If that's more than your time is worth to you, the speed isn't paying for itself.

## Run it

It's a static site with no build step and no dependencies. Open it through any local web server (ES modules don't load from `file://`):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

To publish it, turn on GitHub Pages for this repo (Settings → Pages → Deploy from branch → `main`, `/ (root)`).

## How the model works

All of it lives in [`model.js`](model.js) as pure functions.

- **Fuel.** You enter the car's highway MPG (default 30, measured around 55 mph). Fuel per mile is lowest near 50 mph and grows with aerodynamic drag above that, so each extra 5 mph costs more than the last. Around 80 mph a 30 MPG car gets roughly 22–23 MPG.
- **Interstate.** Steady cruising at your chosen speed: time is distance ÷ speed.
- **City.** Between lights you cruise at your chosen speed. Lights (default 4 per mile) are assumed to be timed for the posted limit, so the faster you go over it, the more often you arrive on red. Each stop costs braking and acceleration time, an average wait of half a red phase, idle fuel, and the fuel to get back up to speed (which grows with speed squared).
- **Risk.** Relative to driving at the limit, injury-crash risk scales with (speed ÷ limit)² and fatal-crash risk with (speed ÷ limit)⁴ (the Nilsson power model). Optionally this becomes a dollar cost using an expected crash cost per mile at the limit (default $0.10, roughly the US economic cost of crashes spread over every mile driven).
- **Verdict.** Extra gas and risk cost ÷ hours saved = cost per hour saved, compared with the value you put on an hour of your time.

These are estimates for comparing speeds against each other, not predictions of a real trip. Speeding tickets, traffic congestion and wear on the car aren't counted.

## License

MIT
