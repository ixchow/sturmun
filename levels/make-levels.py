#!/usr/bin/env python3

#levels from svg to json for sturmun
#based on pat-tools -- https://github.com/textiles-lab/pat-tools/blob/master/svg2pat.py


import sys, math, re, xml.parsers.expat

#svg page is [0, width]x[0, height]:
width = 1
height = 1

#current transform matrix ( in order: [ a, c, e, b, d, f ] )
transform = [ 1, 0, 0,
              0, 1, 0 ]

transform_stack = []


def parse_length(length):
	#as per https://www.w3.org/TR/SVG/coords.html#Units
	m = re.match(r"^(\d+|\d*.\d+|\d+.\d*)(em|ex|px|pt|pc|cm|mm|in|)$", length)
	if m == None:
		print("Failed to parse length '" + length + "'.", file=sys.stderr)
		sys.exit(1)

	l = float(m.group(1))
	if m.group(2) == 'em' or m.group(2) == 'ex':
		print("Length in em/ex units not supported.", file=sys.stderr)
		sys.exit(1)
	elif m.group(2) == 'px' or m.group(2) == '':
		l *= 1.0 / 90.0
	elif m.group(2) == 'pt':
		l *= 1.25 / 90.0
	elif m.group(2) == 'pc':
		l *= 15.0 / 90.0
	elif m.group(2) == 'cm':
		l *= 35.43307 / 90.0
	elif m.group(2) == 'mm':
		l *= 3.543307 / 90.0
	elif m.group(2) == 'in':
		l *= 90.0 / 90.0
	else:
		assert(False) #"unit not supported"

	#convert from inches to cm:
	l *= 2.54

	return l

def multiply_transforms(a, b):
	return [
		a[0] * b[0] + a[1] * b[3] + 0.0 * a[2],
		a[0] * b[1] + a[1] * b[4] + 0.0 * a[2],
		a[0] * b[2] + a[1] * b[5] + 1.0 * a[2],
		a[3] * b[0] + a[4] * b[3] + 0.0 * a[5],
		a[3] * b[1] + a[4] * b[4] + 0.0 * a[5],
		a[3] * b[2] + a[4] * b[5] + 1.0 * a[5]
	]

def apply_transform(xf, pt):
	return (
		xf[0] * pt[0] + xf[1] * pt[1] + xf[2],
		xf[3] * pt[0] + xf[4] * pt[1] + xf[5]
	)

def parse_transform(attrib):
	#handle empty transform:
	m = re.match(r"^\s*$", attrib)
	if m != None:
		return [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]

	#parse the first transform in the list:
	m = re.match(r"^\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(\s*([\s\d+.,-e]+)\s*\)\s*(|[\s,](.*))$", attrib)
	if m == None:
		print("Failed to parse first transform in '" + attrib + "'", file=sys.stderr)
		sys.exit(1)
	op = m.group(1)
	args = re.split(r"\s*[\s,]\s*", m.group(2))
	remain = m.group(4)

	#print(op, args, remain, file=sys.stderr) #DEBUG

	xf = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]

	if op == 'matrix':
		if len(args) != 6:
			print("matrix transform requires six arguments, have only ", args, file=sys.stderr)
			sys.exit(1)
		xf[0] = float(args[0])
		xf[1] = float(args[2])
		xf[2] = float(args[4])
		xf[3] = float(args[1])
		xf[4] = float(args[3])
		xf[5] = float(args[5])
	elif op == 'translate':
		if len(args) < 1 or len(args) > 2:
			print("translate transform requires one or two arguments, have ", args, file=sys.stderr)
			sys.exit(1)
		xf[2] = float(args[0])
		if len(args) > 1:
			xf[5] = float(args[1])
	#elif op == 'scale':
	#elif op == 'rotate':
	#elif op == 'skewX':
	#elif op == 'skewY':
	else:
		print("Unimplemented transformation '" + op + "'.", file=sys.stderr)
		sys.exit(1)

	if remain != None:
		xf = multiply_transforms(xf, parse_transform(remain))
	return xf

#handle_path will fill in capsules, targets, starts:
capsules = []
targets = []
starts = []

def handle_path(data,rad):
	#print("Path: " + data, file=sys.stderr)
	#print("  transform: " + str(transform), file=sys.stderr)

	paths = [] #TODO: something fancier?

	#helpers:
	def trim_wsp():
		nonlocal data
		#was: data = re.sub("^[\x20\x09\x0D\x0A]*", "", data)
		i = 0
		while i < len(data) and (data[i] == '\x20' or data[i] == '\x09' or data[i] == '\x0D' or data[i] == '\x0A'):
			i += 1
		data = data[i:]
	
	def trim_wsp_comma_wsp():
		nonlocal data
		#was: data = re.sub("^"
		#	+ "[\x20\x09\x0D\x0A]*"
		#	+ "[\x20\x09\x0D\x0A,]?"
		#	+ "[\x20\x09\x0D\x0A]*",
		#	"", data)
		i = 0
		while i < len(data) and (data[i] == '\x20' or data[i] == '\x09' or data[i] == '\x0D' or data[i] == '\x0A'):
			i += 1
		if i < len(data) and data[i] == ',':
			i += 1
		while i < len(data) and (data[i] == '\x20' or data[i] == '\x09' or data[i] == '\x0D' or data[i] == '\x0A'):
			i += 1
		data = data[i:]

	def read_number():
		nonlocal data
		m = re.match(r"^([+-]?(?:\d*\.\d+|\d+\.\d*|\d+)(?:[eE][+-]?\d+)?)(.*)", data)
		if m == None:
			raise ValueError("data does not start with number")
		#print("Number:" + m.group(1) + " remain:" + m.group(2), file=sys.stderr) #DEBUG
		data = m.group(2)
		return float(m.group(1))
	
	def read_coordinate_pair():
		x = read_number()
		trim_wsp_comma_wsp()
		y = read_number()
		return [x, y]

	#current point (for relative commands):
	current = (0.0, 0.0)

	#current path segment:
	seg = None

	def xf(pt):
		return apply_transform(transform, pt)
	
	def moveto(pt):
		#print("moveto " + str(pt), file=sys.stderr)
		nonlocal current
		nonlocal seg
		if seg != None:
			paths.append(list(map(xf, seg)))
			#print("   path:" + str(paths[-1]))
		current = pt
		seg = [pt]

	def lineto(pt):
		#print("lineto " + str(pt), file=sys.stderr)
		nonlocal current
		nonlocal seg
		current = pt
		seg.append(pt)
	
	def curveto(xy1, xy2, xy):
		#print("curveto " + str(xy1) + " " + str(xy2) + " " + str(xy), file=sys.stderr)
		nonlocal current
		nonlocal seg

		def subcurveto(xy0, xy1, xy2, xy):
			xf_xy0 = xf(xy0)
			xf_xy1 = xf(xy1)
			xf_xy2 = xf(xy2)
			xf_xy = xf(xy)
			length = 0.0
			length += ((xf_xy1[0] - xf_xy0[0]) ** 2 + (xf_xy1[1] - xf_xy0[1]) ** 2) ** 0.5
			length += ((xf_xy2[0] - xf_xy1[0]) ** 2 + (xf_xy2[1] - xf_xy1[1]) ** 2) ** 0.5
			length += ((xf_xy[0] - xf_xy2[0]) ** 2 + (xf_xy[1] - xf_xy2[1]) ** 2) ** 0.5
			if length > 0.125 * rad:
				m_c1 = (
					0.5 * (xy1[0] - xy0[0]) + xy0[0],
					0.5 * (xy1[1] - xy0[1]) + xy0[1]
				)
				m_12 = (
					0.5 * (xy2[0] - xy1[0]) + xy1[0],
					0.5 * (xy2[1] - xy1[1]) + xy1[1]
				)
				m_2e = (
					0.5 * (xy[0] - xy2[0]) + xy2[0],
					0.5 * (xy[1] - xy2[1]) + xy2[1]
				)
				m_c1_12 = (
					0.5 * (m_12[0] - m_c1[0]) + m_c1[0],
					0.5 * (m_12[1] - m_c1[1]) + m_c1[1]
				)
				m_12_2e = (
					0.5 * (m_2e[0] - m_12[0]) + m_12[0],
					0.5 * (m_2e[1] - m_12[1]) + m_12[1]
				)
				m = (
					0.5 * (m_12_2e[0] - m_c1_12[0]) + m_c1_12[0],
					0.5 * (m_12_2e[1] - m_c1_12[1]) + m_c1_12[1]
				)
				subcurveto(xy0, m_c1, m_c1_12, m)
				subcurveto(m, m_12_2e, m_2e, xy)
			else:
				lineto(xy)

		subcurveto(current, xy1, xy2, xy)
		current = xy
	
	def closepath():
		nonlocal current
		nonlocal seg
		if seg != None:
			lineto(seg[0])

	while True:
		#trim leftmost whitespace:
		trim_wsp()
		if data == "": break

		#command is first character:
		cmd = data[0]
		data = data[1:]

		if cmd == 'm' or cmd == 'M' or cmd == 'l' or cmd == 'L':
			trim_wsp()
			pt = read_coordinate_pair()
			if cmd.islower(): pt = (pt[0] + current[0], pt[1] + current[1])

			if cmd == 'm' or cmd == 'M': moveto(pt)
			else: lineto(pt)

			while True:
				trim_wsp_comma_wsp()
				if data == "": break
				try:
					pt = read_coordinate_pair()
				except ValueError:
					break
				if cmd.islower(): pt = (pt[0] + current[0], pt[1] + current[1])
				lineto(pt)
		elif cmd == 'z' or cmd == 'Z':
			closepath()
		elif cmd == 'h' or cmd == 'H':
			trim_wsp()
			x = read_number()
			if cmd.islower(): x += current[0]
			y = current[1]
			lineto((x,y))
			while True:
				trim_wsp_comma_wsp()
				if data == "": break
				try:
					x = read_number()
				except ValueError:
					break
				if cmd.islower(): x += current[0]
				lineto((x,y))
		elif cmd == 'v' or cmd == 'V':
			trim_wsp()
			x = current[0]
			y = read_number()
			if cmd.islower(): y += current[1]
			lineto((x,y))
			while True:
				trim_wsp_comma_wsp()
				if data == "": break
				try:
					y = read_number()
				except ValueError:
					break
				if cmd.islower(): y += current[1]
				lineto((x,y))
		elif cmd == 'c' or cmd == 'C':
			trim_wsp()
			xy1 = read_coordinate_pair()
			trim_wsp_comma_wsp()
			xy2 = read_coordinate_pair()
			trim_wsp_comma_wsp()
			xy = read_coordinate_pair()

			if cmd.islower():
				xy1 = (xy1[0] + current[0], xy1[1] + current[1])
				xy2 = (xy2[0] + current[0], xy2[1] + current[1])
				xy = (xy[0] + current[0], xy[1] + current[1])

			curveto(xy1, xy2, xy)

			while True:
				trim_wsp_comma_wsp()
				if data == "": break
				try:
					xy1 = read_coordinate_pair()
					trim_wsp_comma_wsp()
					xy2 = read_coordinate_pair()
					trim_wsp_comma_wsp()
					xy = read_coordinate_pair()
				except ValueError:
					break
				if cmd.islower():
					xy1 = (xy1[0] + current[0], xy1[1] + current[1])
					xy2 = (xy2[0] + current[0], xy2[1] + current[1])
					xy = (xy[0] + current[0], xy[1] + current[1])
				curveto(xy1, xy2, xy)
		else:
			print("Unhandled command '" + cmd + "' in path data.", file=sys.stderr)
			sys.exit(1)

	#moveto() will emit path segment if non-empty, so use a last moveto to do that:
	moveto((0.0, 0.0))

	for seg in paths:
		for i in range(0,len(seg)-1):
			#print(f"capsule from {seg[i]} to {seg[i+1]} @ {rad}")
			capsules.append({'a':seg[i], 'b':seg[i+1], 'r':rad})


def start_element(name, attribs):
	global transform, transform_stack, width, height
	transform_stack.append(transform)
	if 'transform' in attribs:
		parsed = parse_transform(attribs['transform'])
		transform = multiply_transforms(transform, parsed)
	
	label = None
	if 'inkscape:label' in attribs:
		label = attribs['inkscape:label']

	if name == 'svg':
		if 'width' in attribs:
			width = parse_length(attribs['width'])
			#print("Width: " + str(width) + "cm", file=sys.stderr)
		else:
			width = parse_length("10cm")
			print("No width in svg element, assuming 10cm", file=sys.stderr)
		if 'height' in attribs:
			height = parse_length(attribs['height'])
			#print("Height: " + str(height) + "cm", file=sys.stderr)
		else:
			height = parse_length("10cm")
			print("No height in svg element, assuming 10cm", file=sys.stderr)
		if 'viewBox' in attribs:
			#print("viewBox: ", attribs['viewBox'], file=sys.stderr)
			vals = re.split(r"\s*[\s,]\s*", attribs['viewBox'])
			assert(len(vals) == 4)
			x = float(vals[0])
			y = float(vals[1])
			w = float(vals[2])
			h = float(vals[3])
			#set transform for viewBox:
			transform = [
				width / w, 0.0, -width / w * x,
				0.0,-height / h, height / h * y + height
			]
		else:
			#transform maps one user unit to one px:
			x = 0.0
			y = 0.0
			w = 90.0 * width
			h = 90.0 * height
			transform = [
				width / w, 0.0, -width / w * x,
				0.0, height / h, -height / h * y
			]
	elif name == 'g':
		pass
	elif name == 'path':
		if label == 'wall':
			rad = None
			if 'style' in attribs:
				#m = re.match(r"^(\d+|\d*.\d+|\d+.\d*)(em|ex|px|pt|pc|cm|mm|in|)$", length)
				m = re.search(r"stroke-width:(\d*\.?\d*);", attribs['style'])
				if m:
					rad = float(m[1]) / 2 #width -> radius
					p1 = apply_transform(transform, [0,0])
					p2 = apply_transform(transform, [rad,0])
					rad = math.sqrt((p1[0]-p2[0])**2 + (p1[1]-p2[1])**2)
					#print(f"Stroke width {m[1]} xformed to radius {rad}")
			if rad is None:
				print("Could not determine stroke width.")
				rad = 0.1

			if 'd' in attribs:
				handle_path(attribs['d'],rad)
		else:
			print(f"Skipping path with label {label}.")
	elif name == 'rect':
		print("TODO: rect element", file=sys.stderr)
	elif name == 'circle':
		cx = float(attribs['cx'])
		cy = float(attribs['cy'])
		at = apply_transform(transform, [cx,cy])
		if label == 'start':
			#print(f"start at {at}")
			starts.append(at)
		elif label == 'target':
			#print(f"target at {at}")
			targets.append(at)
		else:
			print(f"Skipping circle with label {label}.")
	elif name == 'line':
		print("TODO: line element", file=sys.stderr)
		pass
	elif name == 'polyline':
		print("TODO: polyline element", file=sys.stderr)
		pass
	#ignore other elements:
	else:
		pass #print("Unhandled SVG element: '" + name + "'")

def end_element(name):
	global transform, transform_stack
	transform = transform_stack.pop()

parser = xml.parsers.expat.ParserCreate()
parser.StartElementHandler = start_element
parser.EndElementHandler = end_element
parser.ParseFile(open(sys.argv[1], 'rb'))


if len(starts) != 1:
	print(f"Want exactly one start; have {len(starts)}!")
	sys.exit(1)

def fmt(n):
	return f"{round(n * 1000.0) / 1000.0:.3g}"


with open(sys.argv[2], 'wb') as out:
	def o(s):
		out.write(s.encode('utf8'))
	#dump as JSON:
	o('{\n')
	o('\t"start":[' + fmt(starts[0][0]) + ',' + fmt(starts[0][1]) + '],\n')

	o('\t"targets":[')
	first = True
	for t in targets:
		if first:
			o('\n')
			first = False
		else:
			o(',\n')
		o('\t\t[' + fmt(t[0]) + ',' + fmt(t[1]) + ']')
	o('\n\t],\n')
	
	o('\t"capsules":[\n')
	first = True
	for c in capsules:
		if first:
			o('\n')
			first = False
		else:
			o(',\n')
	
		o('\t\t{')
		o(' "a":[' + fmt(c['a'][0]) + ',' + fmt(c['a'][1]) + ']')
		o(', "b":[' + fmt(c['b'][0]) + ',' + fmt(c['b'][1]) + ']')
		o(', "r":' + fmt(c['r']))
		o(' }')
	o('\n\t]\n')
	
	o('}\n')
