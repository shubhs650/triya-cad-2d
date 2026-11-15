import ezdxf
doc = ezdxf.new('R2018', setup=True)
msp = doc.modelspace()
# Fill on, square caps, joints shown.
wall = doc.mline_styles.new('WALL')
wall.dxf.flags = 1 | 2 | 16 | 256
wall.dxf.fill_color = 8
wall.elements.append(1.5, 1)
wall.elements.append(-1.5, 5)
# Round outer caps, inner arcs, four elements with a dashed centre pair.
pipe = doc.mline_styles.new('PIPE')
pipe.dxf.flags = 64 | 1024 | 32 | 512
pipe.elements.append(1.0, 3)
pipe.elements.append(0.3, 2, 'DASHED')
pipe.elements.append(-0.3, 2, 'DASHED')
pipe.elements.append(-1.0, 3)
# Plain standard-like, magenta round caps two colours.
duct = doc.mline_styles.new('DUCT')
duct.dxf.flags = 64 | 1024 | 2
duct.elements.append(0.8, 6)
duct.elements.append(-0.8, 4)
ml = msp.add_mline([(0, 0), (30, 0), (30, 20), (0, 20)], dxfattribs={'style_name': 'WALL', 'scale_factor': 1})
ml.close(True)
ml.update_geometry()
ml2 = msp.add_mline([(5, 5), (25, 5), (25, 15)], dxfattribs={'style_name': 'PIPE', 'scale_factor': 1.5})
ml2.update_geometry()
ml3 = msp.add_mline([(40, 0), (55, 10), (70, 0), (85, 10)], dxfattribs={'style_name': 'DUCT', 'scale_factor': 1.5})
ml3.update_geometry()
ml4 = msp.add_mline([(40, 18), (85, 18)], dxfattribs={'style_name': 'WALL', 'scale_factor': 0.8})
ml4.update_geometry()
doc.saveas('multilines.dxf')
print(doc.audit().has_errors)
