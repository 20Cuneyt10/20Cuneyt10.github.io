// faq.js — FAQ icerigi ve render'i.
// Sorular/cevaplar tek kaynakta duruyor ki ileride eklenecek bot ayni diziyi kullanabilsin.
// Kural: Ingilizce, em dash yok, abartisiz, olculu cevaplar.

window.JUKE_FAQ = [
  {
    q: 'What is this?',
    a: 'A cassette deck for real NASA Earth data. Eight datasets are pressed onto tapes, each tape showing up in the eras its data actually covers. Inserting a tape turns that dataset into sound you can play, and the player shows the same data as an image with a moving playhead.',
  },
  {
    q: 'Why make the data audible at all?',
    a: 'Because a picture is not the only way to read a measurement. At least 2.2 billion people live with a near or distance vision impairment, and about 43 million are blind. A temperature curve or a sea ice map usually reaches people through the eye only, so half of the information never arrives. Sound carries the same numbers: pitch for the value, rhythm for time, texture for how rough the field is.',
    links: [
      ['WHO fact sheet', 'https://www.who.int/news-room/fact-sheets/detail/blindness-and-visual-impairment'],
      ['GBD 2019, Lancet Global Health', 'https://pubmed.ncbi.nlm.nih.gov/33275950/'],
    ],
  },
  {
    q: 'Why a cassette deck instead of a dashboard?',
    a: 'Because interaction is what people remember. Choosing an era, pulling a tape out of a fan and hearing sea ice turn into a chord stays with an audience much longer than a figure on a slide, and it gives a sighted and a non sighted visitor the same way in: you listen, you do not read.',
  },

  {
    q: 'Is the data real?',
    a: 'Yes. Surface temperature is the NASA GISS GISTEMP v4 table, the carbon animation comes from NASA SVS 5196, and the maps are NASA GIBS layers: AMSR2 sea ice, MODIS snow cover, IGBP land cover, IMERG precipitation, MODIS aerosol and net ecosystem CO2 exchange. Every layer is downloaded or cached from NASA; nothing on screen is drawn by hand.',
    links: [
      ['GISTEMP v4', 'https://data.giss.nasa.gov/gistemp/'],
      ['SVS 5196', 'https://svs.gsfc.nasa.gov/5196/'],
      ['GIBS', 'https://www.earthdata.nasa.gov/data/tools/worldview'],
    ],
  },
  {
    q: 'How does an image become sound?',
    a: 'The dataset is resampled to a 512 by 512 grid. Each column is one moment, each row one pitch, and the brightness of a cell decides how loud that pitch is. The audio buffer is built in the browser, so there are no pre-recorded tracks and no backend.',
  },
  {
    q: 'What is the difference between the two engines?',
    a: 'v2 reads the image the way a spectrogram reads: 16 partials per column, mono, 4.8 kHz low pass. v3 maps the same columns onto an A minor pentatonic ladder, keeps at most 6 partials and spreads them in stereo, so it sounds like an instrument rather than a scan. The deck always uses v3; on the globe you switch with the motor button.',
  },
  {
    q: 'Why do some eras show fewer tapes?',
    a: 'A tape only appears if its dataset exists for that era. Sea ice starts in 2012, land cover in 2001, carbon flux in 2015. Choose 1990 and only temperature and carbon are on the rack.',
  },
  {
    q: 'What if the chosen year has no data for a layer?',
    a: 'The app loads the closest year it does have and writes that year next to the era, for example ERA 2025 with DATA 2020. It never interpolates a frame that does not exist.',
  },
  {
    q: 'Does it work offline?',
    a: 'The offline kit yes: map tiles and the eight datasets ship inside the folder, so it opens without a network. The lite kit pulls map tiles while you browse and needs a connection for a few seconds at the start.',
  },
  {
    q: 'What can I do on the 3D planet?',
    a: 'Drag to rotate, use the wheel or the plus and minus buttons to zoom, and click any patch of Earth. The region is loaded at the matching zoom level and sonified exactly like a tape.',
  },
  {
    q: 'Does anything get sent to a server?',
    a: 'No account, no tracking, no audio upload. Everything runs in the browser. The only outbound requests are NASA tiles and data files for a layer that is not cached yet.',
  },
  {
    q: 'Where do the credits go?',
    a: 'VOXTERRA is built by ANKATECH. Datasets: NASA GISS, NASA SVS, NASA GIBS, NSIDC, NASA GPM and the MODIS teams. The accessibility figures come from the WHO fact sheet on blindness and vision impairment and from GBD 2019 (Lancet Global Health, 2021). The gallery motion is inspired by Niklas Knaack\u2019s carousel. The sound engines, the cassette deck and the globe wiring are our own work.',
    links: [
      ['NASA GISS', 'https://data.giss.nasa.gov/gistemp/'],
      ['NSIDC', 'https://nsidc.org/data/au_si12'],
      ['NASA GPM', 'https://gpm.nasa.gov/data/imerg'],
    ],
  },
];

(function renderFaq() {
  const host = () => document.getElementById('faqList');
  function build() {
    const el = host();
    if (!el) return;
    el.innerHTML = (window.JUKE_FAQ || []).map((item, i) => {
      const links = (item.links || [])
        .map(([label, href]) => `<a href="${href}" target="_blank" rel="noopener">${label}</a>`)
        .join(' · ');
      return `<article class="faq-item">
        <h2>${item.q}</h2>
        <p>${item.a}</p>
        ${links ? `<p class="faq-links">${links}</p>` : ''}
      </article>`;
    }).join('');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
