import React, { useMemo, useState } from 'react';

// Shared FAQ page — searchable, category-grouped accordion with a help/video
// sidebar. Driven entirely by props so the Company and Seller portals render the
// same UI with their own copy (see lib/faqData.js) and their own videos.
//
// Props:
//   title, subtitle       – header copy
//   sections              – [{ category, icon, video?, items: [{ q, a }] }]
//                           `icon` is a material-symbols name; `video` (optional)
//                           overrides the sidebar featured video when that
//                           category is open — { title, description, embedUrl,
//                           thumbnail, duration }.
//   media                 – { featured, demos, demosHref, help, proTip } — the
//                           right-hand sidebar. All optional; see defaults below.

const RED = '#EA2831';

const DEFAULT_MEDIA = {
  featured: {
    title: 'Getting Started',
    description: 'Dekhiye kaise portal par account banaye aur basic setup karein.',
    embedUrl: '', // ← paste a YouTube/Vimeo embed URL or an mp4 file URL here
    thumbnail: '',
    duration: '',
  },
  demos: [],
  demosHref: '',
  help: {
    email: 'support@khetify.com',
    chatDesc: 'Support team se turant jawab payein.',
    ticketDesc: 'Support team tak apni baat pahunchayein.',
    callHours: 'Mon–Sat, 10 AM–6 PM',
  },
  proTip: 'FAQ ko search ya category se filter karke aap jaldi sahi jawab tak pahunch sakte hain.',
};

// Render the featured video: an iframe for embed URLs, a <video> for direct file
// URLs, else a placeholder prompting to add one.
const VideoPlayer = ({ video }) => {
  const src = video?.embedUrl || '';
  const isFile = /\.(mp4|webm|ogg)(\?|$)/i.test(src);

  if (!src) {
    return (
      <div className="aspect-video w-full rounded-xl bg-stone-900 flex flex-col items-center justify-center text-center gap-2 text-stone-400">
        <span className="material-symbols-outlined text-4xl">smart_display</span>
        <span className="text-xs px-4">Video yahan aayega — media.featured.embedUrl set karein.</span>
      </div>
    );
  }

  if (isFile) {
    return (
      <video
        controls
        poster={video.thumbnail || undefined}
        className="aspect-video w-full rounded-xl bg-black object-cover"
      >
        <source src={src} />
      </video>
    );
  }

  return (
    <div className="aspect-video w-full rounded-xl overflow-hidden bg-black">
      <iframe
        src={src}
        title={video.title || 'Video'}
        className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
};

const FaqView = ({ title = 'FAQ', subtitle, sections = [], media }) => {
  const cfg = {
    ...DEFAULT_MEDIA,
    ...media,
    featured: { ...DEFAULT_MEDIA.featured, ...(media?.featured || {}) },
    help: { ...DEFAULT_MEDIA.help, ...(media?.help || {}) },
  };

  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [openCats, setOpenCats] = useState(() => ({ 0: true })); // first category open
  const [openItem, setOpenItem] = useState('0-0'); // first question open
  const [feedback, setFeedback] = useState({}); // { 'si-ii': 'up' | 'down' }

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  // Sections after the category dropdown + search filters. Each carries its
  // original index (`_i`) so open/feedback keys stay stable while filtering.
  const visible = useMemo(() => {
    return sections
      .map((s, i) => ({ ...s, _i: i }))
      .filter((s) => catFilter === 'all' || s.category === catFilter)
      .map((s) => ({
        ...s,
        _items: searching
          ? s.items.filter((it) => it.q.toLowerCase().includes(q) || it.a.toLowerCase().includes(q))
          : s.items,
      }))
      .filter((s) => !searching || s._items.length > 0);
  }, [sections, catFilter, q, searching]);

  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const shown = visible.reduce((n, s) => n + s._items.length, 0);

  // The open category's own video wins over the default featured video.
  const activeVideo = useMemo(() => {
    const openWithVideo = visible.find((s) => (searching || openCats[s._i]) && s.video);
    return openWithVideo?.video || cfg.featured;
  }, [visible, openCats, searching, cfg.featured]);

  const toggleCat = (i) => setOpenCats((m) => ({ ...m, [i]: !m[i] }));

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-stone-50 font-sora">
      <div className="max-w-6xl mx-auto w-full">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-stone-900">{title}</h1>
            {subtitle && (
              <p className="text-stone-500 mt-2 text-sm sm:text-base leading-relaxed max-w-2xl">{subtitle}</p>
            )}
          </div>
          <div
            className="hidden sm:flex shrink-0 h-16 w-16 rounded-2xl items-center justify-center"
            style={{ background: `${RED}12` }}
          >
            <span className="material-symbols-outlined text-3xl" style={{ color: RED }}>
              quiz
            </span>
          </div>
        </div>

        {/* Search + category filter */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-[20px]">
              search
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search questions…"
              className="w-full h-12 pl-11 pr-16 rounded-xl border border-stone-300 bg-white outline-none focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/10 text-sm"
            />
            {searching && (
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-bold text-stone-400">
                {shown} / {total}
              </span>
            )}
          </div>
          <div className="relative sm:w-56">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-[20px] pointer-events-none">
              filter_list
            </span>
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="w-full h-12 pl-11 pr-8 rounded-xl border border-stone-300 bg-white outline-none focus:border-[#EA2831] focus:ring-2 focus:ring-[#EA2831]/10 text-sm appearance-none cursor-pointer text-stone-700"
            >
              <option value="all">All Categories</option>
              {sections.map((s) => (
                <option key={s.category} value={s.category}>
                  {s.category}
                </option>
              ))}
            </select>
            <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 text-[20px] pointer-events-none">
              expand_more
            </span>
          </div>
        </div>

        {/* Two-column: FAQ list + sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
          {/* Left: categories */}
          <div className="space-y-3">
            {visible.length === 0 ? (
              <div className="border border-dashed border-stone-200 rounded-2xl p-10 text-center text-stone-400 text-sm bg-white">
                "{query}" se koi FAQ match nahi hua. Kisi aur keyword se try karein.
              </div>
            ) : (
              visible.map((section) => {
                const si = section._i;
                const isOpen = searching || !!openCats[si];
                return (
                  <div key={section.category} className="border border-stone-200 rounded-2xl bg-white overflow-hidden">
                    {/* Category header row */}
                    <button
                      onClick={() => !searching && toggleCat(si)}
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-stone-50 transition-colors"
                    >
                      <span
                        className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: `${RED}12`, color: RED }}
                      >
                        <span className="material-symbols-outlined text-[20px]">{section.icon || 'help'}</span>
                      </span>
                      <span
                        className={`flex-1 text-xs font-bold uppercase tracking-wider ${
                          isOpen ? 'text-[#EA2831]' : 'text-stone-700'
                        }`}
                      >
                        {section.category}
                      </span>
                      <span className="text-[11px] font-bold text-stone-400 bg-stone-100 rounded-full px-2 py-0.5">
                        {section._items.length}
                      </span>
                      {!searching && (
                        <span
                          className={`material-symbols-outlined text-stone-400 shrink-0 transition-transform ${
                            isOpen ? 'rotate-180' : ''
                          }`}
                        >
                          expand_more
                        </span>
                      )}
                    </button>

                    {/* Questions */}
                    {isOpen && (
                      <div className="px-3 pb-3 space-y-2">
                        {section._items.map((it, ii) => {
                          const key = `${si}-${ii}`;
                          const itemOpen = openItem === key;
                          const vote = feedback[key];
                          return (
                            <div key={key} className="border border-stone-200 rounded-xl overflow-hidden">
                              <button
                                onClick={() => setOpenItem(itemOpen ? null : key)}
                                className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                                  itemOpen ? 'bg-[#EA2831]/[0.04]' : 'hover:bg-stone-50'
                                }`}
                              >
                                <span className="text-sm font-semibold text-stone-800">{it.q}</span>
                                <span
                                  className={`material-symbols-outlined text-stone-400 shrink-0 transition-transform ${
                                    itemOpen ? 'rotate-180' : ''
                                  }`}
                                >
                                  expand_more
                                </span>
                              </button>
                              {itemOpen && (
                                <div className="px-4 pb-4">
                                  <p className="text-sm text-stone-600 leading-relaxed">{it.a}</p>
                                  <div className="mt-3 flex items-center gap-3 text-xs text-stone-400">
                                    <span>Was this answer helpful?</span>
                                    <button
                                      onClick={() => setFeedback((f) => ({ ...f, [key]: 'up' }))}
                                      className={`h-7 w-7 rounded-lg border flex items-center justify-center transition-colors ${
                                        vote === 'up'
                                          ? 'border-green-500 text-green-600 bg-green-50'
                                          : 'border-stone-200 text-stone-400 hover:bg-stone-50'
                                      }`}
                                      aria-label="Helpful"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">thumb_up</span>
                                    </button>
                                    <button
                                      onClick={() => setFeedback((f) => ({ ...f, [key]: 'down' }))}
                                      className={`h-7 w-7 rounded-lg border flex items-center justify-center transition-colors ${
                                        vote === 'down'
                                          ? 'border-[#EA2831] text-[#EA2831] bg-[#EA2831]/5'
                                          : 'border-stone-200 text-stone-400 hover:bg-stone-50'
                                      }`}
                                      aria-label="Not helpful"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">thumb_down</span>
                                    </button>
                                    {vote && <span className="text-green-600 font-medium">Thanks for the feedback!</span>}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Right: sidebar */}
          <div className="space-y-6 lg:sticky lg:top-4">
            {/* Video card */}
            <div className="border border-stone-200 rounded-2xl bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="material-symbols-outlined text-[20px]" style={{ color: RED }}>
                  play_circle
                </span>
                <h3 className="text-sm font-bold text-stone-900">{activeVideo.title || 'Video'}</h3>
              </div>
              {activeVideo.description && (
                <p className="text-xs text-stone-500 leading-relaxed mb-3">{activeVideo.description}</p>
              )}
              <VideoPlayer video={activeVideo} />
              {cfg.demosHref && (
                <a
                  href={cfg.demosHref}
                  className="mt-3 w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-xl border border-[#EA2831] text-[#EA2831] text-sm font-semibold hover:bg-[#EA2831]/5 transition-colors"
                >
                  View all demo videos
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </a>
              )}
            </div>

            {/* Need more help */}
            {/* <div className="border border-stone-200 rounded-2xl bg-white p-4">
              <h3 className="text-sm font-bold text-stone-900 mb-3">Need More Help?</h3>
              <div className="space-y-2">
                <a
                  href={`mailto:${cfg.help.email}`}
                  className="flex items-center gap-3 p-3 rounded-xl border border-stone-100 hover:border-stone-200 hover:bg-stone-50 transition-colors"
                >
                  <span className="h-9 w-9 rounded-lg bg-[#EA2831]/10 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[20px]" style={{ color: RED }}>
                      confirmation_number
                    </span>
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-stone-800">Raise a Ticket</span>
                    <span className="block text-xs text-stone-500">{cfg.help.ticketDesc}</span>
                  </span>
                </a>
                <a
                  href={`mailto:${cfg.help.email}`}
                  className="flex items-center gap-3 p-3 rounded-xl border border-stone-100 hover:border-stone-200 hover:bg-stone-50 transition-colors"
                >
                  <span className="h-9 w-9 rounded-lg bg-[#EA2831]/10 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[20px]" style={{ color: RED }}>
                      mail
                    </span>
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-stone-800">Email Us</span>
                    <span className="block text-xs text-stone-500">{cfg.help.email}</span>
                  </span>
                </a>
                <div className="flex items-center gap-3 p-3 rounded-xl border border-stone-100">
                  <span className="h-9 w-9 rounded-lg bg-[#EA2831]/10 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[20px]" style={{ color: RED }}>
                      call
                    </span>
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-stone-800">Call Us</span>
                    <span className="block text-xs text-stone-500">{cfg.help.callHours}</span>
                  </span>
                </div>
              </div>
            </div> */}

            {/* Pro tip */}
            {/* {cfg.proTip && (
              <div className="rounded-2xl border border-green-100 bg-green-50 p-4 flex gap-3">
                <span className="material-symbols-outlined text-green-600 text-[20px] shrink-0">lightbulb</span>
                <div>
                  <p className="text-sm font-bold text-green-800">Pro Tip</p>
                  <p className="text-xs text-green-700 leading-relaxed mt-0.5">{cfg.proTip}</p>
                </div>
              </div>
            )} */}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FaqView;
