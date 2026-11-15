# Data provenance

## Radiation

NASA RadLab, ISS Columbus, DosTel1 and DosTel2, March 27, 2015 through March 2,
2016. 585,235 original readings. Accessed November 14, 2026.

- Detector: https://visualization.osdr.nasa.gov/radlab/gui/knowledgebase/DosTel1
- API units: https://visualization.osdr.nasa.gov/radlab/gui/data-api/
- Exact query and SHA256: `aerol/data/snapshot.json` → `provenance.radiation`

`iss-radiation.csv.gz` preserves the complete downloaded CSV. Decompress it with
Python's gzip library or an archive utility. It contains timestamps, instrument
IDs, absorbed dose rate (µGy/h) and spacecraft. Measurements are environmental,
not Scott Kelly's personal dosimeter record. NASA hosts data from international
instrument partners; hosting does not imply every instrument is NASA-built.

The plotted daily values are time-weighted means from trapezoidal integration
of successive readings separated by no more than 600 seconds. Long gaps remain
missing. Observed dose is divided by observed hours. Daily plotting and matched
correlations require ≥80% coverage; coverage remains available in source records.
No duplicates, negative rates or missing values were found in this mission export.

## TERRA

Al-Turki et al. (2024), DOI 10.1038/s42003-024-06014-x.
https://www.nature.com/articles/s42003-024-06014-x

Supplementary Data 2, TW subject, canonical UUAGGG normalized RNA motif abundance.
Eight in-flight values and three postflight values. The paper is CC BY 4.0;
retain attribution to its authors and identify derived transformations. Display
values multiply source abundance by 1,000 only. HR preflight observations belong
to the ground twin, not Scott's personal preflight baseline.

Calendar mapping: NASA NTRS 20160012724, slide 24.
https://ntrs.nasa.gov/citations/20160012724
Each FD date agrees with March 27, 2015 plus FD days. Collection clock times are
not verified. Postflight dates use March 2, 2016 plus R+ days and are labeled as
derived dates; they are excluded from contemporaneous ISS associations.

## Exploratory association

This is a new descriptive analysis, not a NASA-published correlation. Primary:
preceding seven-day mean dose rate, midnight sample-date cutoff, DosTel1. DosTel2,
1/30-day windows and +/-1-day cutoffs are sensitivity checks. The +1-day cutoff
includes the sample date and may include exposure after a blood draw.

Seven-day primary Pearson r ≈0.810 (DosTel1) and ≈0.859 (DosTel2), n=7 per
detector. FD334 has only about 78% coverage and is excluded. Linear-time-adjusted
descriptive r ≈0.210 and ≈0.587. One astronaut, serial samples, environmental
exposure proxies and common time trends preclude causal or clinical conclusions.
FD192 coincides with a post-vaccination collection on NASA's timeline.

Original Twins Study: https://pmc.ncbi.nlm.nih.gov/articles/PMC7580864/
It reports a 76.18 mGy physical dosimeter mission dose. This app does not spread
that total over days or use it to calibrate TERRA or station detector rates.

## Solar event markers

NOAA solar proton event catalog hosted by NASA:
https://umbra.nascom.nasa.gov/SEP/
Five events during the downloaded interval: June 18, June 21, June 26 and
October 29, 2015; January 2, 2016. Peak flux is GOES >10 MeV proton flux in pfu,
not ISS dosimetry. A marker does not attribute a station peak to solar particles.
The June 21 event peaked June 22 at 19:00 UTC (1,070 pfu). June 9 and July 27
TERRA samples cannot resolve an acute response to that event.

## Measurement semantics

- HRV method: RMSSD is the square root of mean squared successive NN differences.
  https://onlinelibrary.wiley.com/doi/full/10.1111/psyp.14604
- FDA pulse oximetry information:
  https://www.fda.gov/medical-devices/products-and-medical-procedures/pulse-oximeters
  A medical-grade comparator is useful for confirmation; it does not by itself
  establish full clinical calibration of a new wrist sensor algorithm.

No local crew readings are bundled. No bone measurements are included.
Public data retain their original provider terms; the MIT code license does not
relicense NASA-hosted international datasets.
