# Texture credits

Every image here is a 2048×1024 JPG made from NASA or USGS imagery and loaded by `web/components/scene/`.
Sizes and distances in the scene are not to scale (see the comment at the top of `web/components/scene/system.ts`).
All source URLs below were downloaded successfully on 2026-11-14. Files were resized and re-encoded with ImageMagick; any other processing is listed.

NASA states that its media "generally are not subject to copyright in the United States" and asks to be acknowledged as the source
(<https://www.nasa.gov/nasa-brand-center/images-and-media/>). Using these images does not imply NASA endorsement.

## Earth

| File | Source | Credit | Processing |
| --- | --- | --- | --- |
| `earth_day.jpg` | Blue Marble: Next Generation with topography and bathymetry, August 2004. <https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/august/world.topo.bathy.200408.3x5400x2700.jpg> (listed on <https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/>) | NASA Earth Observatory (Reto Stöckli) | Resized |
| `earth_night.jpg` | Earth at Night (Black Marble) 2016, 0.1 degree color map. <https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_01deg.jpg> | NASA Earth Observatory, Suomi NPP VIIRS data | Resized |
| `earth_clouds.jpg` | Blue Marble: Clouds. <https://assets.science.nasa.gov/content/dam/science/esd/eo/content-feature/bluemarble/images/cloud_combined_2048.jpg> | NASA Goddard Space Flight Center, image by Reto Stöckli | Converted to grayscale (used as an alpha map) |
| `earth_bump.jpg` | Blue Marble topography, 0 to 6400 m. <https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/topography/gebco_08_rev_elev_5400x2700.jpg> (listed on <https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/topography-bathymetry-maps/>) | "Imagery by Jesse Allen, NASA's Earth Observatory, using data from the General Bathymetric Chart of the Oceans (GEBCO) produced by the British Oceanographic Data Centre." | Converted to grayscale, resized |
| `earth_ocean.jpg` | Blue Marble bathymetry, -8000 to 0 m. <https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bathymetry/gebco_08_rev_bath_5400x2700.jpg> (same page as above) | Same credit as `earth_bump.jpg` | Thresholded into a land/water mask: white = land, gray = water. Used as a roughness map so only the oceans are glossy |

The two elevation images are NASA Earth Observatory products built on GEBCO data. GEBCO states: "The GEBCO Grid is placed in the public domain and may be used free of charge"
(<https://www.gebco.net/data-products/gridded-bathymetry-data>).

## Moon

| File | Source | Credit | Processing |
| --- | --- | --- | --- |
| `moon_color.jpg` | CGI Moon Kit, color map. <https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_2k.tif> (page: <https://svs.gsfc.nasa.gov/4720/>) | NASA's Scientific Visualization Studio. Data: Lunar Reconnaissance Orbiter Camera (LROC) | Converted from TIFF |
| `moon_bump.jpg` | CGI Moon Kit, displacement map. <https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16_uint.tif> (same page) | NASA's Scientific Visualization Studio. Data: Lunar Orbiter Laser Altimeter (LOLA) | Contrast stretched to the full 8-bit range, resized |

## Mars

Both maps were assembled from the 32 level-2 tiles (8 × 4, 256 px each) of the NASA Solar System Treks tile service (<https://trek.nasa.gov/mars/>).

| File | Source | Credit | Processing |
| --- | --- | --- | --- |
| `mars_color.jpg` | Viking MDIM 2.1 colorized global mosaic, 232 m. Tiles `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/2/{row}/{col}.jpg`, rows 0 to 3, columns 0 to 7 | NASA / JPL / USGS Astrogeology Science Center | Tiles joined |
| `mars_bump.jpg` | Mars Global Surveyor MOLA elevation model, 463 m, 8-bit. Tiles `https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_DEM_mosaic_global_463m_8/1.0.0/default/default028mm/2/{row}/{col}.png`, same rows and columns | NASA / GSFC MOLA Science Team / USGS Astrogeology Science Center | Tiles joined, contrast stretched to the full 8-bit range |

## Mercury, Venus, Jupiter

Mercury and Venus were assembled from level-2 tiles of the NASA Solar System Treks tile service, the same way as Mars. Downloaded 2026-11-14.

| File | Source | Credit | Processing |
| --- | --- | --- | --- |
| `mercury_color.jpg` | MESSENGER MDIS color basemap, 665 m. Tiles `https://trek.nasa.gov/tiles/Mercury/EQ/Mercury_MESSENGER_MDIS_Basemap_MD3Color_Mosaic_Global_665m/1.0.0/default/default028mm/2/{row}/{col}.jpg`, rows 0 to 3, columns 0 to 7 | NASA / Johns Hopkins University Applied Physics Laboratory / Carnegie Institution of Washington | Tiles joined, color saturation reduced to 55% (the source is an enhanced-color product) |
| `venus_color.jpg` | Magellan radar mosaic, colorized, 4641 m. Tiles `https://trek.nasa.gov/tiles/Venus/EQ/Venus_Magellan_C3-MDIR_Colorized_Global_Mosaic_4641m/1.0.0/default/default028mm/2/{row}/{col}.png`, same rows and columns | NASA / JPL / USGS Astrogeology Science Center | Tiles joined. This is the radar view of the surface, not the cloud tops seen in visible light |
| `jupiter_color.jpg` | "Cassini's Best Maps of Jupiter (Cylindrical Map)", PIA07782. <https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/pia07/pia07782/PIA07782.jpg> (page: <https://science.nasa.gov/photojournal/cassinis-best-maps-of-jupiter-cylindrical-map/>) | NASA / JPL / Space Science Institute | Resized |

## Drawn in code, not NASA imagery

These have no image file. They are procedural art in `web/components/scene/textures.ts` and `system.ts`:
the Sun and its glow, Saturn and its rings, Uranus, Neptune, the asteroid belt, the starfield and Milky Way band,
and every spacecraft and habitat model.

## If a file is missing

The scene keeps working: each planet starts with a procedural canvas texture and only swaps to the image once it loads.
To restore a file, download its source URL above and convert it, for example:

```sh
magick world.topo.bathy.200408.3x5400x2700.jpg -resize 2048x1024! -strip -quality 86 earth_day.jpg
```
