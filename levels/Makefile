
all : ../levels.js

../levels.js : Makefile level0.json level1.json level2.json level3.json
	echo 'const LEVELS = [' > '$@'
	cat level0.json >> '$@'
	echo ',' >> '$@'
	cat level1.json >> '$@'
	echo ',' >> '$@'
	cat level2.json >> '$@'
	echo ',' >> '$@'
	cat level3.json >> '$@'
	echo '];' >> '$@'

%.json : %.svg make-levels.py
	./make-levels.py '$<' '$@'
