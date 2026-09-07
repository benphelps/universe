import math
from pathlib import Path
n=12
rows=[]
for k in range(129):
    tilt=math.pi/2*k/128
    row=[]
    for j in range(n):
        y=-1+2*(j+.5)/n
        value=0
        for a in range(512):
            d=math.sin(tilt)*math.sin(2*math.pi*(a+.5)/512)
            aa=y*d;bb=math.sqrt((1-y*y)*(1-d*d))
            h=math.acos(max(-1,min(1,-aa/max(bb,1e-30))))
            value+=(h*aa+bb*math.sin(h))/math.pi/512
        row.append(value)
    rows.extend(row)
Path('src/universe/planet/annualInsolationTable.ts').write_text('/** Offline fixed-declination rotation average integrated over true anomaly.\n * 129 tilts (0..pi/2), 12 equal-area latitude centres, 512 orbital samples.\n * Reproduce with scripts/generate-annual-insolation.py. */\nexport const ANNUAL_INSOLATION_TABLE = new Float64Array([\n'+''.join('  '+','.join(format(x,'.12g') for x in rows[i:i+12])+',\n' for i in range(0,len(rows),12))+']);\n')
