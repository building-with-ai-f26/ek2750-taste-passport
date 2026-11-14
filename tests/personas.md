# Test personas

Three made-up people with clearly different taste, all living in New York, all going to **London** and **Istanbul** for the same reason. If the app really understands taste, their guides should look very different.

They clash on purpose: Brooke dislikes two of Mara's favorites (Roberta's, Sunny's Bar), and Sam dislikes two of Brooke's (Carbone, Le Bain). Watch whether the app keeps those apart.

The same data lives in `tests/personas/*.json`, which the script uses.

## Two ways to test

**A. Automatic (all 3 personas, both cities, about $0.02):**

1. Start the app: `node --env-file=.env app/server.js`
2. In a second terminal: `node tests/run-personas.js baseline`
3. Open the file it saves in `tests/results/` and fill in the score columns.

**B. By hand in the app (to see what a real user sees):** copy one persona below into the form at http://localhost:3000.

## How to score each guide

For every pick, answer three questions:

1. **Real place?** Does it exist and is it where the app says? (Google it.)
2. **Would they like it?** Read the persona's "about" line. Would *they* actually go?
3. **Clashes with a dislike?** Is it loud and sceney for Mara, divey for Brooke, pricey for Sam?

**Target:** at least 7 of 10 picks liked, zero dislike clashes, zero made-up places.

Also check across personas: if the same place shows up for two different people, that's a sign the app is giving generic picks.

---

## Mara — alternative / artsy

*28, lives in Bushwick, works at a gallery. Likes places with a creative crowd, a bit scrappy, music or art in the room. Hates anything sceney, corporate or touristy.*

- **Home city:** New York
- **Destination:** London (then repeat with Istanbul)
- **What the trip is for:** a 4-day trip with a friend

| | Place | Note |
|---|---|---|
| Love | Roberta's | Wood-fired pizza in a scrappy warehouse with a garden. Feels like a friend's party, full of artists and musicians. |
| Love | Metrograph | Indie cinema with a moody bar and restaurant upstairs. I go for an old film and stay for a drink. |
| Love | Mood Ring | Tiny astrology-themed bar, DJs on weeknights, cheap drinks, everyone's dressed weird in a good way. |
| Love | Dimes | Bright, plant-filled cafe. Healthy, creative food and a crowd that looks like they all make zines. |
| Love | Sunny's Bar | Old dive bar in Red Hook with live bluegrass jams. Feels like nothing has changed in 50 years. |
| Dislike | Tao Downtown | Loud club music, bottle service energy, huge and corporate. Felt like a theme park. |
| Dislike | Magnolia Bakery | Long tourist line for an average cupcake. All hype. |

## Brooke — mainstream / trendy

*27, lives on the Upper East Side, works in marketing. Loves pretty, buzzy, see-and-be-seen places she can dress up for and post about. Dislikes divey, scruffy or hard-to-get-to spots.*

- **Home city:** New York
- **Destination:** London (then repeat with Istanbul)
- **What the trip is for:** a 4-day trip with a friend

| | Place | Note |
|---|---|---|
| Love | Carbone | Glamorous, waiters in tuxedos, the spicy rigatoni. Feels like a special night out and you might see someone famous. |
| Love | Sadelle's | Gorgeous brunch, the bagel tower is so photogenic. Bright and buzzy, perfect with friends. |
| Love | Bemelmans Bar | Classic, glamorous hotel bar with live piano. Great martinis, I love getting dressed up for it. |
| Love | Ralph's Coffee | So cute and polished, green and white everything. My go-to coffee stop when I'm shopping. |
| Love | Le Bain | Rooftop at The Standard with amazing views and a fun dance floor. Great for a big night out. |
| Dislike | Roberta's | Long trek to Bushwick, picnic tables and too hipster. Not my scene at all. |
| Dislike | Sunny's Bar | Dark and divey, hard to get to and they barely make cocktails. |

## Sam — budget foodie

*31, lives in Queens, a teacher. Cares only about how good the food is for the money. Happy standing at a counter or eating on the street. Dislikes fancy, pricey, reservation-only places.*

- **Home city:** New York
- **Destination:** London (then repeat with Istanbul)
- **What the trip is for:** a 4-day trip with a friend

| | Place | Note |
|---|---|---|
| Love | Xi'an Famous Foods | Spicy hand-pulled noodles for under $15. Fast, no frills, insanely good. |
| Love | Joe's Pizza | The perfect classic New York slice. Eat it standing on the sidewalk. |
| Love | Los Tacos No. 1 | Standing-room tacos, short menu, everything made fresh in front of you. Worth the line. |
| Love | Mamoun's Falafel | Cheap, open late, been around forever. Best falafel sandwich after a night out. |
| Love | McSorley's Old Ale House | Ancient bar, only two beers (light or dark), sawdust on the floor, cheap and no pretense. |
| Dislike | Carbone | Impossible to book and $30+ for a bowl of pasta. Feels like you're paying for the show. |
| Dislike | Le Bain | Cover charge, dress code, $20 cocktails. Too much effort to have a drink. |
