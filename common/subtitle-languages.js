"use strict";

// English first, followed by major world languages and Europe's national and
// regional languages. BCP 47 values are shared by the editor and player.
const codes = "en af sq am ar hy az eu be bn bs br bg my ca zh-Hans zh-Hant co hr cs da nl eo et fo fi fr fy gl ka de el gu ht ha he hi hu is ig id ga it ja kn kk km ko ku ky lo la lv lt lb mk ms ml mt mi mr mn sr-ME ne se nb nn oc or ps fa pl pt pt-BR pa ro rm ru gd sr sk sl so es sw sv tl ta tt te th bo tr tk uk ur ug uz vi cy yi yo zu".split(" ");
const names = new Intl.DisplayNames(["en"], { type: "language" });
const labels = { "sr-ME": "Montenegrin", "bo": "Tibetan", "se": "Northern Sami" };
const subtitleLanguages = codes.map(language => ({ language, label: labels[language] || names.of(language) }));
subtitleLanguages.sort((a, b) => a.language === "en" ? -1 : b.language === "en" ? 1 : a.label.localeCompare(b.label, "en"));

module.exports = { subtitleLanguages };
