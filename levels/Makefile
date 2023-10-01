
all : ../levels.js

../levels.js : Makefile \
		level-title.json \
		level-star.json \
		level-hill.json \
		level-reach.json \
		level-gaps.json \
		level-climb.json \
		level-ending.json \

	echo 'const LEVELS = [' > '$@'
	cat level-title.json >> '$@'
	echo ',' >> '$@'
	cat level-star.json >> '$@'
	echo ',' >> '$@'
	cat level-hill.json >> '$@'
	echo ',' >> '$@'
	cat level-reach.json >> '$@'
	echo ',' >> '$@'
	cat level-climb.json >> '$@'
	echo ',' >> '$@'
	cat level-gaps.json >> '$@'
	echo ',' >> '$@'
	cat level-ending.json >> '$@'
	echo '];' >> '$@'

%.json : %.svg make-levels.py
	./make-levels.py '$<' '$@'
