# Covering-number report — pre-seed library

Pool: 1315 filtered candidates. Tier 1: 79 seeds placed first.
Embedding: bge-small-en-v1.5 (production NN space), cosine similarity.

| similarity floor | seeds needed (incl. Tier 1) | FPS additions beyond Tier 1 |
|---|---|---|
| 0.55 | 113 | 34 |
| 0.60 | 228 | 149 |
| 0.65 | 449 | 370 |
| 0.70 | 729 | 650 |
| 0.75 | 979 | 900 |

## Floor 0.55 — worst-covered survivors (candidate → nearest seed)

- slot machine → piggy bank (0.550)
- calzone → sifter (0.550)
- toga → fish (0.552)
- footbath → boat (0.552)
- tape measure → wire cutters (0.552)
- pinecone → lighthouse (0.553)
- kiwi → banana (0.553)
- okra → candelabra (0.553)

## Floor 0.60 — worst-covered survivors (candidate → nearest seed)

- cash register → key (0.600)
- gurney → windmill (0.601)
- scone → sword (0.601)
- pallet → lip balm (0.602)
- stroller → loveseat (0.602)
- backgammon → gearshift (0.602)
- ostrich → dinosaur (0.602)
- lamb chop → hamburger (0.602)

## Floor 0.65 — worst-covered survivors (candidate → nearest seed)

- pita → boa (0.650)
- coffin → snail (0.650)
- match → glue (0.650)
- anteater → cleaver (0.650)
- seal → key (0.651)
- asparagus → bagel (0.651)
- man → woman (0.651)
- notebook → computer screen (0.651)

## Floor 0.70 — worst-covered survivors (candidate → nearest seed)

- beetle → butterfly (0.701)
- bat → battery (0.701)
- rat → spider (0.701)
- throne → crown (0.701)
- torch → chimney (0.701)
- horseshoe → slide (0.701)
- stump → wreath (0.702)
- eggplant → egg roll (0.702)

## Floor 0.75 — worst-covered survivors (candidate → nearest seed)

- seaplane → airplane (0.750)
- doorknocker → doorhandle (0.750)
- flag → flagpole (0.750)
- teacup → coffee cup (0.750)
- cannon → barrel (0.751)
- bonnet → jug (0.751)
- wrap → glue (0.751)
- cassette → reel (0.751)

## Library size vs display gate

For each floor's prefix library: % of remaining pool candidates whose nearest
seed clears each display gate.

| library (floor) | size | gate 0.60 | gate 0.65 | gate 0.70 | gate 0.75 |
|---|---|---|---|---|---|
| 0.55 | 113 | 81% | 47% | 23% | 9% |
| 0.60 | 228 | 100% | 68% | 33% | 15% |
| 0.65 | 449 | 100% | 100% | 58% | 27% |
| 0.70 | 729 | 100% | 100% | 100% | 52% |
| 0.75 | 979 | 100% | 100% | 100% | 100% |

### Typical pairs, 113-seed library (floor 0.55) — random sample, not worst-case

- iron → lion (0.661)
- bottle opener → mug (0.651)
- corn → pumpkin (0.703)
- antelope → shark (0.592)
- sandwich → hamburger (0.763)
- seismograph → camera (0.582)
- padlock → key (0.631)
- pig → rabbit (0.711)
- mannequin → horse (0.593)
- match → key (0.621)
- satellite → star (0.692)
- magnifier → sifter (0.611)

### Typical pairs, 228-seed library (floor 0.60) — random sample, not worst-case

- ring → sword (0.635)
- jukebox → pillbox (0.662)
- leopard → lion (0.787)
- lasagna → hamburger (0.617)
- ham → hamburger (0.651)
- knife → sword (0.712)
- hose → umbrella (0.645)
- duffel bag → sleeping bag (0.750)
- dishwashing liquid → lip balm (0.603)
- grater → pizza (0.633)
- diskette → metronome (0.606)
- laptop → airplane (0.650)

### Typical pairs, 449-seed library (floor 0.65) — random sample, not worst-case

- lime → almond (0.683)
- highlighter → pencil sharpener (0.689)
- box → ballot box (0.742)
- heater → dryer (0.737)
- cornbread → biscuit (0.658)
- doghouse → house (0.694)
- fork → forklift (0.725)
- cow → dog (0.748)
- christmas tree → tree (0.834)
- tambourine → guitar (0.703)
- wine cooler → mug (0.651)
- spring roll → egg roll (0.791)

### Typical pairs, 729-seed library (floor 0.70) — random sample, not worst-case

- air conditioner → ceiling fan (0.704)
- lime → plum (0.721)
- ukulele → guitar (0.732)
- microwave → radar (0.722)
- matchbox → match (0.784)
- panda → lion (0.758)
- olive → almond (0.716)
- lightbulb → floor lamp (0.730)
- thermometer → thermos (0.768)
- lip gloss → lip balm (0.807)
- light bulb → floor lamp (0.782)
- tray → trough (0.703)

### Typical pairs, 979-seed library (floor 0.75) — random sample, not worst-case

- pickup truck → truck (0.850)
- cleat → cleaver (0.823)
- cocktail → margarita (0.784)
- rocking horse → horse (0.759)
- sandwich → cheese (0.766)
- lampshade → floor lamp (0.765)
- bonnet → jug (0.751)
- recorder → record player (0.762)
- doorknob → doorstop (0.768)
- door → doorstop (0.811)
- crocodile → alligator (0.826)
- desk → table (0.768)

## Holdout queries (not drawn from the pool)

| query | nearest seed (all 979) | sim | nearest seed (228-lib) | sim |
|---|---|---|---|---|
| monstera deliciosa | margarita | 0.592 | mushroom | 0.590 |
| garden gnome | vase | 0.649 | flower | 0.628 |
| water tower | waterslide | 0.697 | waterslide | 0.697 |
| mars rover | robot | 0.700 | robot | 0.700 |
| golden retriever | dog | 0.705 | dog | 0.705 |
| koi fish | fish | 0.737 | fish | 0.737 |
| viking ship | rocket ship | 0.738 | rocket ship | 0.738 |
| morel mushroom | mushroom | 0.745 | mushroom | 0.745 |
| pirate ship | rocket ship | 0.753 | rocket ship | 0.753 |
| gingerbread house | gingerbread man | 0.784 | house | 0.682 |
| space station | space shuttle | 0.795 | rocket ship | 0.730 |
| race car | car | 0.797 | car | 0.797 |
| duck confit | duck | 0.798 | duck | 0.798 |
| t rex | dinosaur | 0.803 | dinosaur | 0.803 |
| grand piano | piano | 0.808 | key | 0.616 |
| observatory | telescope | 0.819 | kaleidoscope | 0.630 |
| crate engine | crate | 0.822 | squirt gun | 0.623 |
| dune buggy | buggy | 0.847 | buggy | 0.847 |
| bonsai tree | bonsai | 0.951 | tree | 0.771 |

- floor 0.55: 19/19 holdout queries within floor (of the final 979-seed list)
- floor 0.60: 18/19 holdout queries within floor (of the final 979-seed list)
- floor 0.65: 17/19 holdout queries within floor (of the final 979-seed list)
- floor 0.70: 16/19 holdout queries within floor (of the final 979-seed list)
- floor 0.75: 11/19 holdout queries within floor (of the final 979-seed list)
