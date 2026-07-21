# Covering-number report — pre-seed library

Pool: 1315 filtered candidates. Tier 1: 79 seeds placed first.
Embedding: Xenova/bge-base-en-v1.5, cosine similarity.

| similarity floor | seeds needed (incl. Tier 1) | FPS additions beyond Tier 1 |
|---|---|---|
| 0.55 | 79 | 0 |
| 0.60 | 114 | 35 |
| 0.65 | 293 | 214 |
| 0.70 | 652 | 573 |
| 0.75 | 957 | 878 |

## Floor 0.55 — worst-covered survivors (candidate → nearest seed)

- inhaler → airplane (0.551)
- payphone → hat (0.565)
- guillotine → umbrella (0.575)
- ski boots → apple (0.575)
- gas mask → motorcycle (0.575)
- baseball → hat (0.578)
- noisemaker → key (0.581)
- plunger → submarine (0.581)

## Floor 0.60 — worst-covered survivors (candidate → nearest seed)

- brussels sprouts → pumpkin (0.600)
- hot tub → sun (0.601)
- pinball → hat (0.601)
- coat rack → tape measure (0.601)
- waffle iron → mug (0.601)
- tiramisu → table (0.602)
- kimono → dragon (0.602)
- scone → pumpkin (0.603)

## Floor 0.65 — worst-covered survivors (candidate → nearest seed)

- stethoscope → goggles (0.650)
- xylophone → pitchfork (0.650)
- steering wheel → truck (0.651)
- radish → mushroom (0.651)
- binder → key (0.651)
- acorn → owl (0.651)
- medal → champagne (0.651)
- walker → stroller (0.651)

## Floor 0.70 — worst-covered survivors (candidate → nearest seed)

- shield → cloak (0.700)
- skull → dinosaur (0.700)
- joystick → pinball (0.700)
- bison → whale (0.700)
- peanut → mushroom (0.700)
- palette → pallet (0.701)
- jacket → straightjacket (0.701)
- bagpipe → flute (0.701)

## Floor 0.75 — worst-covered survivors (candidate → nearest seed)

- sundial → sun (0.750)
- leopard → tiger (0.750)
- matchbox → toolbox (0.750)
- coconut → banana (0.750)
- ring → napkin ring (0.751)
- bunkbed → cot (0.751)
- poodle → dog (0.751)
- armor → gear (0.751)

## Library size vs display gate

For each floor's prefix library: % of remaining pool candidates whose nearest
seed clears each display gate.

| library (floor) | size | gate 0.60 | gate 0.65 | gate 0.70 | gate 0.75 |
|---|---|---|---|---|---|
| 0.55 | 79 | 95% | 56% | 21% | 7% |
| 0.60 | 114 | 100% | 68% | 27% | 9% |
| 0.65 | 293 | 100% | 100% | 50% | 19% |
| 0.70 | 652 | 100% | 100% | 100% | 46% |
| 0.75 | 957 | 100% | 100% | 100% | 100% |

### Typical pairs, 79-seed library (floor 0.55) — random sample, not worst-case

- suit → chair (0.685)
- stop sign → truck (0.591)
- sock → hat (0.686)
- spam → key (0.617)
- van → truck (0.760)
- tape measure → table (0.595)
- surfboard → dolphin (0.662)
- star fruit → star (0.819)
- seagull → bird (0.744)
- syringe → mug (0.608)
- slot machine → robot (0.615)
- snowplow → snowman (0.732)

### Typical pairs, 114-seed library (floor 0.60) — random sample, not worst-case

- brussels sprouts → pumpkin (0.600)
- bamboo → pumpkin (0.676)
- iron → banana (0.637)
- lizard → dragon (0.736)
- radish → mushroom (0.651)
- scoop → ice cream cone (0.646)
- limousine → car (0.741)
- turbine → windmill (0.752)
- seal → bear (0.634)
- straightjacket → hat (0.631)
- shell → snail (0.705)
- shortbread → pizza (0.623)

### Typical pairs, 293-seed library (floor 0.65) — random sample, not worst-case

- hummingbird → bird (0.761)
- bench → chair (0.680)
- footbath → iceskate (0.681)
- dishwasher → dryer (0.725)
- altar → pulpit (0.696)
- turbine → windmill (0.752)
- dagger → sword (0.719)
- pie → pizza (0.745)
- hairbrush → paintbrush (0.798)
- cushion → chair (0.729)
- doghouse → house (0.735)
- dartboard → washboard (0.699)

### Typical pairs, 652-seed library (floor 0.70) — random sample, not worst-case

- diskette → hard disk (0.735)
- step stool → stool (0.810)
- machine gun → staple gun (0.741)
- paper bag → sandbag (0.727)
- magnifying glass → magnifier (0.858)
- rattle → rattlesnake (0.789)
- orange → olive (0.750)
- ostrich → bird (0.726)
- lunchbox → mailbox (0.714)
- ping pong table → table (0.825)
- radar → microwave (0.717)
- matchbox → match (0.746)

### Typical pairs, 957-seed library (floor 0.75) — random sample, not worst-case

- yoke → yo yo (0.779)
- iron → soldering iron (0.755)
- beer → keg (0.770)
- hockey puck → puck (0.915)
- bed → sofa bed (0.817)
- cheese → string cheese (0.786)
- grapes → grapevine (0.798)
- bug → lightning bug (0.819)
- hummingbird → bird (0.761)
- cookie sheet → cookie (0.794)
- toast → toaster oven (0.762)
- teacup → teapot (0.811)

## Holdout queries (not drawn from the pool)

| query | nearest seed (all 957) | sim | nearest seed (114-lib) | sim |
|---|---|---|---|---|
| monstera deliciosa | mushroom | 0.667 | mushroom | 0.667 |
| garden gnome | garden hose | 0.692 | flower | 0.629 |
| golden retriever | dog | 0.730 | dog | 0.730 |
| space station | space shuttle | 0.741 | rocket ship | 0.617 |
| water tower | waterwheel | 0.748 | waterslide | 0.722 |
| viking ship | cruise ship | 0.751 | boat | 0.693 |
| mars rover | robot | 0.764 | robot | 0.764 |
| observatory | telescope | 0.770 | magnifier | 0.634 |
| pirate ship | cruise ship | 0.775 | rocket ship | 0.770 |
| morel mushroom | mushroom | 0.778 | mushroom | 0.778 |
| crate engine | engine | 0.778 | car | 0.672 |
| race car | car | 0.787 | car | 0.787 |
| koi fish | fish | 0.794 | fish | 0.794 |
| dune buggy | buggy | 0.802 | motorcycle | 0.644 |
| duck confit | duck | 0.811 | duck | 0.811 |
| t rex | dinosaur | 0.813 | dinosaur | 0.813 |
| gingerbread house | gingerbread man | 0.820 | house | 0.678 |
| grand piano | piano | 0.845 | key | 0.628 |
| bonsai tree | bonsai | 0.961 | tree | 0.808 |

- floor 0.55: 19/19 holdout queries within floor (of the final 957-seed list)
- floor 0.60: 19/19 holdout queries within floor (of the final 957-seed list)
- floor 0.65: 19/19 holdout queries within floor (of the final 957-seed list)
- floor 0.70: 17/19 holdout queries within floor (of the final 957-seed list)
- floor 0.75: 14/19 holdout queries within floor (of the final 957-seed list)
