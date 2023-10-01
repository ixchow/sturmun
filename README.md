# Sturmun The Dancing Starfish

[Play Here](https://ixchow.github.io/sturmun/).

This fumblecore game about controlling a dancing starfish was made in 48 hours for [LD#54](https://ldjam.com/events/ludum-dare/54) (theme: Limited Space) by [Jim McCann / TCHOW llc](http://tchow.com).

Play by pressing `q`, `w`, `e`, `a`, and `d` to grow the Sturmun's limbs. Guide it to the stars to beat each level. Sturmun will grow as it touches more stars. (Theme connection: the amount of space inside Sturmun is limited. Also starfishes can sneak into small spaces. Though maybe that's more an octopus thing.)

Alternative play mode: listen to hardbass music and make Sturmun dance!

## Level Editing

Levels are exported from svg files by the `levels/make-levels.py` script, called from `levels/Makefile` (which also compiles the levels into a single `levels.js` file).
