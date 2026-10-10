// src/test/encoding-fixtures.ts
//
// Product-feed text in many languages, encoded to bytes by an INDEPENDENT encoder (Python's codecs), so the detector is
// tested against files it did not produce itself. `text` is what the bytes must decode to; `encoding` is what Excel or
// the supplier's system would have saved them as. Generated once; edit by regenerating, not by hand.

export interface EncodingFixture {
  name: string;
  encoding: "windows-1250" | "windows-1251" | "windows-1252" | "iso-8859-2" | "iso-8859-15";
  text: string;
  base64: string;
}

export const ENCODING_FIXTURES: EncodingFixture[] = [
  {
    "name": "cs as windows-1250",
    "encoding": "windows-1250",
    "text": "Dámské kožené boty – černé, velikost 38. Vhodné pro každodenní nošení; příjemný materiál, odolná podešev. Cena: 1 299 Kč. Žlutý svetr z ovčí vlny, ruční výroba, šířka 52 cm. Čepice zimní, šedá, úsporná velikost. Řetízek ze stříbra, květináč, hřeben, ďábel, ťuk, žárovka, lůžko.",
    "base64": "ROFtc2vpIGtvnmVu6SBib3R5IJYg6GVybuksIHZlbGlrb3N0IDM4LiBWaG9kbukgcHJvIGthnmRvZGVubu0gbm+aZW7tOyBw+O1qZW1u/SBtYXRlcmnhbCwgb2RvbG7hIHBvZGWaZXYuIENlbmE6IDEgMjk5IEvoLiCObHV0/SBzdmV0ciB6IG926O0gdmxueSwgcnXobu0gdv1yb2JhLCCa7fhrYSA1MiBjbS4gyGVwaWNlIHppbW7tLCCaZWThLCD6c3Bvcm7hIHZlbGlrb3N0LiDYZXTtemVrIHplIHN0+O1icmEsIGt27HRpbuHoLCBo+GViZW4sIO/hYmVsLCCddWssIJ7hcm92a2EsIGz5nmtvLg=="
  },
  {
    "name": "cs as iso-8859-2",
    "encoding": "iso-8859-2",
    "text": "Dámské kožené boty - černé, velikost 38. Vhodné pro každodenní nošení; příjemný materiál, odolná podešev. Cena: 1 299 Kč. Žlutý svetr z ovčí vlny, ruční výroba, šířka 52 cm. Čepice zimní, šedá, úsporná velikost. Řetízek ze stříbra, květináč, hřeben, ďábel, ťuk, žárovka, lůžko.",
    "base64": "ROFtc2vpIGtvvmVu6SBib3R5IC0g6GVybuksIHZlbGlrb3N0IDM4LiBWaG9kbukgcHJvIGthvmRvZGVubu0gbm+5ZW7tOyBw+O1qZW1u/SBtYXRlcmnhbCwgb2RvbG7hIHBvZGW5ZXYuIENlbmE6IDEgMjk5IEvoLiCubHV0/SBzdmV0ciB6IG926O0gdmxueSwgcnXobu0gdv1yb2JhLCC57fhrYSA1MiBjbS4gyGVwaWNlIHppbW7tLCC5ZWThLCD6c3Bvcm7hIHZlbGlrb3N0LiDYZXTtemVrIHplIHN0+O1icmEsIGt27HRpbuHoLCBo+GViZW4sIO/hYmVsLCC7dWssIL7hcm92a2EsIGz5vmtvLg=="
  },
  {
    "name": "pl as windows-1250",
    "encoding": "windows-1250",
    "text": "Męskie buty skórzane – brązowe, rozmiar 42. Wygodne, trwałe, idealne na jesień. Cena: 249,00 zł. Zażółć gęślą jaźń: łódź, świeże zioła, żółty ręcznik kąpielowy, ładowarka do telefonu, koszula męska, spodnie dżinsowe, Gdańsk, źrebię.",
    "base64": "Tepza2llIGJ1dHkgc2vzcnphbmUgliBicrl6b3dlLCByb3ptaWFyIDQyLiBXeWdvZG5lLCB0cndhs2UsIGlkZWFsbmUgbmEgamVzaWXxLiBDZW5hOiAyNDksMDAgerMuIFphv/Oz5iBn6pxsuSBqYZ/xOiCz82SfLCCcd2llv2Ugemlvs2EsIL/zs3R5IHLqY3puaWsga7lwaWVsb3d5LCCzYWRvd2Fya2EgZG8gdGVsZWZvbnUsIGtvc3p1bGEgbepza2EsIHNwb2RuaWUgZL9pbnNvd2UsIEdkYfFzaywgn3JlYmnqLg=="
  },
  {
    "name": "pl as iso-8859-2",
    "encoding": "iso-8859-2",
    "text": "Męskie buty skórzane - brązowe, rozmiar 42. Wygodne, trwałe, idealne na jesień. Cena: 249,00 zł. Zażółć gęślą jaźń: łódź, świeże zioła, żółty ręcznik kąpielowy, ładowarka do telefonu, koszula męska, spodnie dżinsowe, Gdańsk, źrebię.",
    "base64": "Tepza2llIGJ1dHkgc2vzcnphbmUgLSBicrF6b3dlLCByb3ptaWFyIDQyLiBXeWdvZG5lLCB0cndhs2UsIGlkZWFsbmUgbmEgamVzaWXxLiBDZW5hOiAyNDksMDAgerMuIFphv/Oz5iBn6rZssSBqYbzxOiCz82S8LCC2d2llv2Ugemlvs2EsIL/zs3R5IHLqY3puaWsga7FwaWVsb3d5LCCzYWRvd2Fya2EgZG8gdGVsZWZvbnUsIGtvc3p1bGEgbepza2EsIHNwb2RuaWUgZL9pbnNvd2UsIEdkYfFzaywgvHJlYmnqLg=="
  },
  {
    "name": "hu as windows-1250",
    "encoding": "windows-1250",
    "text": "Női bőr cipő – fekete, 38-as méret. Kényelmes, tartós, minden napra. Ár: 12 990 Ft. Őszi kabát, nyári ruha, hűtőszekrény, tűzhely, öltöny, újság, árvíztűrő tükörfúrógép, ügyfél, tőzsde, műanyag.",
    "base64": "TvVpIGL1ciBjaXD1IJYgZmVrZXRlLCAzOC1hcyBt6XJldC4gS+lueWVsbWVzLCB0YXJ083MsIG1pbmRlbiBuYXByYS4gwXI6IDEyIDk5MCBGdC4g1XN6aSBrYWLhdCwgbnnhcmkgcnVoYSwgaPt09XN6ZWty6W55LCB0+3poZWx5LCD2bHT2bnksIPpqc+FnLCDhcnbtenT7cvUgdPxr9nJm+nLzZ+lwLCD8Z3lm6WwsIHT1enNkZSwgbfthbnlhZy4="
  },
  {
    "name": "hu as iso-8859-2",
    "encoding": "iso-8859-2",
    "text": "Női bőr cipő - fekete, 38-as méret. Kényelmes, tartós, minden napra. Ár: 12 990 Ft. Őszi kabát, nyári ruha, hűtőszekrény, tűzhely, öltöny, újság, árvíztűrő tükörfúrógép, ügyfél, tőzsde, műanyag.",
    "base64": "TvVpIGL1ciBjaXD1IC0gZmVrZXRlLCAzOC1hcyBt6XJldC4gS+lueWVsbWVzLCB0YXJ083MsIG1pbmRlbiBuYXByYS4gwXI6IDEyIDk5MCBGdC4g1XN6aSBrYWLhdCwgbnnhcmkgcnVoYSwgaPt09XN6ZWty6W55LCB0+3poZWx5LCD2bHT2bnksIPpqc+FnLCDhcnbtenT7cvUgdPxr9nJm+nLzZ+lwLCD8Z3lm6WwsIHT1enNkZSwgbfthbnlhZy4="
  },
  {
    "name": "sk as windows-1250",
    "encoding": "windows-1250",
    "text": "Dámske kožené topánky – čierne, veľkosť 38. Pohodlné, odolné. Cena: 49,90 €. Žltý sveter z ovčej vlny, ručná výroba, ľahký, teplý, štýlový. Ďakujeme, môžete nás kontaktovať ôsmy deň, ľan, žľab, ŕŕ, vĺna.",
    "base64": "ROFtc2tlIGtvnmVu6SB0b3Dhbmt5IJYg6Gllcm5lLCB2Zb5rb3OdIDM4LiBQb2hvZGxu6Swgb2RvbG7pLiBDZW5hOiA0OSw5MCCALiCObHT9IHN2ZXRlciB6IG926GVqIHZsbnksIHJ16G7hIHb9cm9iYSwgvmFoa/0sIHRlcGz9LCCadP1sb3b9LiDPYWt1amVtZSwgbfSeZXRlIG7hcyBrb250YWt0b3ZhnSD0c215IGRl8iwgvmFuLCCevmFiLCDg4CwgduVuYS4="
  },
  {
    "name": "sk as iso-8859-2",
    "encoding": "iso-8859-2",
    "text": "Dámske kožené topánky - čierne, veľkosť 38. Pohodlné, odolné. Cena: 49,90  EUR. Žltý sveter z ovčej vlny, ručná výroba, ľahký, teplý, štýlový. Ďakujeme, môžete nás kontaktovať ôsmy deň, ľan, žľab, ŕŕ, vĺna.",
    "base64": "ROFtc2tlIGtvvmVu6SB0b3Dhbmt5IC0g6Gllcm5lLCB2ZbVrb3O7IDM4LiBQb2hvZGxu6Swgb2RvbG7pLiBDZW5hOiA0OSw5MCAgRVVSLiCubHT9IHN2ZXRlciB6IG926GVqIHZsbnksIHJ16G7hIHb9cm9iYSwgtWFoa/0sIHRlcGz9LCC5dP1sb3b9LiDPYWt1amVtZSwgbfS+ZXRlIG7hcyBrb250YWt0b3ZhuyD0c215IGRl8iwgtWFuLCC+tWFiLCDg4CwgduVuYS4="
  },
  {
    "name": "hr as windows-1250",
    "encoding": "windows-1250",
    "text": "Ženske kožne cipele – crne, veličina 38. Udobne i izdržljive. Cijena: 89,00 kn. Šešir, đumbir, čokolada, ćevapi, žličica, džemper, đak, mačka, šuma, žena, čaj, ćup.",
    "base64": "jmVuc2tlIGtvnm5lIGNpcGVsZSCWIGNybmUsIHZlbGnoaW5hIDM4LiBVZG9ibmUgaSBpemRynmxqaXZlLiBDaWplbmE6IDg5LDAwIGtuLiCKZZppciwg8HVtYmlyLCDob2tvbGFkYSwg5mV2YXBpLCCebGnoaWNhLCBknmVtcGVyLCDwYWssIG1h6GthLCCadW1hLCCeZW5hLCDoYWosIOZ1cC4="
  },
  {
    "name": "hr as iso-8859-2",
    "encoding": "iso-8859-2",
    "text": "Ženske kožne cipele - crne, veličina 38. Udobne i izdržljive. Cijena: 89,00 kn. Šešir, đumbir, čokolada, ćevapi, žličica, džemper, đak, mačka, šuma, žena, čaj, ćup.",
    "base64": "rmVuc2tlIGtvvm5lIGNpcGVsZSAtIGNybmUsIHZlbGnoaW5hIDM4LiBVZG9ibmUgaSBpemRyvmxqaXZlLiBDaWplbmE6IDg5LDAwIGtuLiCpZblpciwg8HVtYmlyLCDob2tvbGFkYSwg5mV2YXBpLCC+bGnoaWNhLCBkvmVtcGVyLCDwYWssIG1h6GthLCC5dW1hLCC+ZW5hLCDoYWosIOZ1cC4="
  },
  {
    "name": "de as windows-1252",
    "encoding": "windows-1252",
    "text": "Herren-Lederschuhe in Braun, Größe 42. Bequem, strapazierfähig, für jede Jahreszeit. Preis: 89,90 €. Süße Äpfel, schöne Öfen, Fußmatte, Übergröße, Wärmflasche, Küchenmaschine, Mädchen, Gemüse, Bücher.",
    "base64": "SGVycmVuLUxlZGVyc2NodWhlIGluIEJyYXVuLCBHcvbfZSA0Mi4gQmVxdWVtLCBzdHJhcGF6aWVyZuRoaWcsIGb8ciBqZWRlIEphaHJlc3plaXQuIFByZWlzOiA4OSw5MCCALiBT/N9lIMRwZmVsLCBzY2j2bmUg1mZlbiwgRnXfbWF0dGUsINxiZXJncvbfZSwgV+RybWZsYXNjaGUsIEv8Y2hlbm1hc2NoaW5lLCBN5GRjaGVuLCBHZW38c2UsIEL8Y2hlci4="
  },
  {
    "name": "de as iso-8859-15",
    "encoding": "iso-8859-15",
    "text": "Herren-Lederschuhe in Braun, Größe 42. Bequem, strapazierfähig, für jede Jahreszeit. Preis: 89,90 €. Süße Äpfel, schöne Öfen, Fußmatte, Übergröße, Wärmflasche, Küchenmaschine, Mädchen, Gemüse, Bücher.",
    "base64": "SGVycmVuLUxlZGVyc2NodWhlIGluIEJyYXVuLCBHcvbfZSA0Mi4gQmVxdWVtLCBzdHJhcGF6aWVyZuRoaWcsIGb8ciBqZWRlIEphaHJlc3plaXQuIFByZWlzOiA4OSw5MCCkLiBT/N9lIMRwZmVsLCBzY2j2bmUg1mZlbiwgRnXfbWF0dGUsINxiZXJncvbfZSwgV+RybWZsYXNjaGUsIEv8Y2hlbm1hc2NoaW5lLCBN5GRjaGVuLCBHZW38c2UsIEL8Y2hlci4="
  },
  {
    "name": "fr as windows-1252",
    "encoding": "windows-1252",
    "text": "Chaussures en cuir pour homme, marron, pointure 42. Confortables et résistantes, idéales pour l'été. Prix : 89,90 €. Crème brûlée, garçon, œuf, cœur, où, déjà, noël, forêt, bientôt, façade, élève, être, île.",
    "base64": "Q2hhdXNzdXJlcyBlbiBjdWlyIHBvdXIgaG9tbWUsIG1hcnJvbiwgcG9pbnR1cmUgNDIuIENvbmZvcnRhYmxlcyBldCBy6XNpc3RhbnRlcywgaWTpYWxlcyBwb3VyIGwn6XTpLiBQcml4IDogODksOTAggC4gQ3LobWUgYnL7bOllLCBnYXLnb24sIJx1ZiwgY5x1ciwgb/ksIGTpauAsIG5v62wsIGZvcup0LCBiaWVudPR0LCBmYedhZGUsIOls6HZlLCDqdHJlLCDubGUu"
  },
  {
    "name": "fr as iso-8859-15",
    "encoding": "iso-8859-15",
    "text": "Chaussures en cuir pour homme, marron, pointure 42. Confortables et résistantes, idéales pour l'été. Prix : 89,90 €. Crème brûlée, garçon, œuf, cœur, où, déjà, noël, forêt, bientôt, façade, élève, être, île.",
    "base64": "Q2hhdXNzdXJlcyBlbiBjdWlyIHBvdXIgaG9tbWUsIG1hcnJvbiwgcG9pbnR1cmUgNDIuIENvbmZvcnRhYmxlcyBldCBy6XNpc3RhbnRlcywgaWTpYWxlcyBwb3VyIGwn6XTpLiBQcml4IDogODksOTAgpC4gQ3LobWUgYnL7bOllLCBnYXLnb24sIL11ZiwgY711ciwgb/ksIGTpauAsIG5v62wsIGZvcup0LCBiaWVudPR0LCBmYedhZGUsIOls6HZlLCDqdHJlLCDubGUu"
  },
  {
    "name": "es as windows-1252",
    "encoding": "windows-1252",
    "text": "Zapatos de cuero para hombre, color marrón, talla 42. Cómodos y duraderos. Precio: 89,90 €. Niño, pingüino, canción, jamón, camión, mañana, árbol, también, más, después, ¿Qué tal?, ¡Oferta!",
    "base64": "WmFwYXRvcyBkZSBjdWVybyBwYXJhIGhvbWJyZSwgY29sb3IgbWFycvNuLCB0YWxsYSA0Mi4gQ/Ntb2RvcyB5IGR1cmFkZXJvcy4gUHJlY2lvOiA4OSw5MCCALiBOafFvLCBwaW5n/GlubywgY2FuY2nzbiwgamFt824sIGNhbWnzbiwgbWHxYW5hLCDhcmJvbCwgdGFtYmnpbiwgbeFzLCBkZXNwdelzLCC/UXXpIHRhbD8sIKFPZmVydGEh"
  },
  {
    "name": "es as iso-8859-15",
    "encoding": "iso-8859-15",
    "text": "Zapatos de cuero para hombre, color marrón, talla 42. Cómodos y duraderos. Precio: 89,90 €. Niño, pingüino, canción, jamón, camión, mañana, árbol, también, más, después, ¿Qué tal?, ¡Oferta!",
    "base64": "WmFwYXRvcyBkZSBjdWVybyBwYXJhIGhvbWJyZSwgY29sb3IgbWFycvNuLCB0YWxsYSA0Mi4gQ/Ntb2RvcyB5IGR1cmFkZXJvcy4gUHJlY2lvOiA4OSw5MCCkLiBOafFvLCBwaW5n/GlubywgY2FuY2nzbiwgamFt824sIGNhbWnzbiwgbWHxYW5hLCDhcmJvbCwgdGFtYmnpbiwgbeFzLCBkZXNwdelzLCC/UXXpIHRhbD8sIKFPZmVydGEh"
  },
  {
    "name": "pt as windows-1252",
    "encoding": "windows-1252",
    "text": "Sapatos de couro masculinos, marrom, tamanho 42. Confortáveis e duráveis. Preço: R$ 189,90. Coração, ação, informação, pão, mãe, avô, você, três, até, pé, às, fábrica, órgão.",
    "base64": "U2FwYXRvcyBkZSBjb3VybyBtYXNjdWxpbm9zLCBtYXJyb20sIHRhbWFuaG8gNDIuIENvbmZvcnThdmVpcyBlIGR1cuF2ZWlzLiBQcmXnbzogUiQgMTg5LDkwLiBDb3Jh5+NvLCBh5+NvLCBpbmZvcm1h5+NvLCBw428sIG3jZSwgYXb0LCB2b2PqLCB0cupzLCBhdOksIHDpLCDgcywgZuFicmljYSwg83Jn428u"
  },
  {
    "name": "pt as iso-8859-15",
    "encoding": "iso-8859-15",
    "text": "Sapatos de couro masculinos, marrom, tamanho 42. Confortáveis e duráveis. Preço: R$ 189,90. Coração, ação, informação, pão, mãe, avô, você, três, até, pé, às, fábrica, órgão.",
    "base64": "U2FwYXRvcyBkZSBjb3VybyBtYXNjdWxpbm9zLCBtYXJyb20sIHRhbWFuaG8gNDIuIENvbmZvcnThdmVpcyBlIGR1cuF2ZWlzLiBQcmXnbzogUiQgMTg5LDkwLiBDb3Jh5+NvLCBh5+NvLCBpbmZvcm1h5+NvLCBw428sIG3jZSwgYXb0LCB2b2PqLCB0cupzLCBhdOksIHDpLCDgcywgZuFicmljYSwg83Jn428u"
  },
  {
    "name": "sv as windows-1252",
    "encoding": "windows-1252",
    "text": "Herrskor i läder, bruna, storlek 42. Bekväma och hållbara. Pris: 899 kr. Smörgås, äpple, hälsa, flickor, sjö, å, ö, påsk, grönt, blåbär, sköna, björn.",
    "base64": "SGVycnNrb3IgaSBs5GRlciwgYnJ1bmEsIHN0b3JsZWsgNDIuIEJla3bkbWEgb2NoIGjlbGxiYXJhLiBQcmlzOiA4OTkga3IuIFNt9nJn5XMsIORwcGxlLCBo5GxzYSwgZmxpY2tvciwgc2r2LCDlLCD2LCBw5XNrLCBncvZudCwgYmzlYuRyLCBza/ZuYSwgYmr2cm4u"
  },
  {
    "name": "da as windows-1252",
    "encoding": "windows-1252",
    "text": "Herresko i læder, brune, størrelse 42. Behagelige og holdbare. Pris: 899 kr. Rødgrød, blåbær, smørrebrød, ærlig, øl, ål, åben, hjælp, søster, grøn, bælte.",
    "base64": "SGVycmVza28gaSBs5mRlciwgYnJ1bmUsIHN0+HJyZWxzZSA0Mi4gQmVoYWdlbGlnZSBvZyBob2xkYmFyZS4gUHJpczogODk5IGtyLiBS+GRncvhkLCBibOVi5nIsIHNt+HJyZWJy+GQsIOZybGlnLCD4bCwg5WwsIOViZW4sIGhq5mxwLCBz+HN0ZXIsIGdy+G4sIGLmbHRlLg=="
  },
  {
    "name": "is as windows-1252",
    "encoding": "windows-1252",
    "text": "Karlaskór úr leðri, brúnir, stærð 42. Þægilegir og endingargóðir. Verð: 12.900 kr. Þökk, gæði, hundrað, vikuna, öðru, fæðing, ýmis, Ísland, Þór.",
    "base64": "S2FybGFza/NyIPpyIGxl8HJpLCBicvpuaXIsIHN05nLwIDQyLiDe5mdpbGVnaXIgb2cgZW5kaW5nYXJn8/Bpci4gVmVy8DogMTIuOTAwIGtyLiDe9mtrLCBn5vBpLCBodW5kcmHwLCB2aWt1bmEsIPbwcnUsIGbm8GluZywg/W1pcywgzXNsYW5kLCDe83Iu"
  },
  {
    "name": "ru as windows-1251",
    "encoding": "windows-1251",
    "text": "Мужские кожаные ботинки, коричневые, размер 42. Удобные и прочные, подходят на каждый день. Цена: 4 990 руб. Зимняя шапка, шерстяной свитер, ёжик, щётка, чайник, объём, подъезд, юбка, ярко-жёлтый.",
    "base64": "zPPm8ero5SDq7ubg7fvlIOHu8ujt6ugsIOru8Oj37eXi++UsIPDg5+zl8CA0Mi4g0+Tu4e375SDoIO/w7vft++UsIO/u5PXu5P/yIO3gIOrg5uT76SDk5e38LiDW5e3gOiA0IDk5MCDw8+EuIMfo7O3//yD44O/q4Cwg+OXw8fL/7e7pIPHi6PLl8CwguObo6iwg+bjy6uAsIPfg6e3o6iwg7uH6uOwsIO/u5Prl5+QsIP7h6uAsIP/w6u4t5rjr8vvpLg=="
  },
  {
    "name": "uk as windows-1251",
    "encoding": "windows-1251",
    "text": "Чоловічі шкіряні черевики, коричневі, розмір 42. Зручні та міцні. Ціна: 1 890 грн. Їжак, Європа, ґанок, єдиний, дякуємо, подарунок, пляшка, щоденник, київ, їжа.",
    "base64": "1+7r7uKz97Mg+Oqz8P/tsyD35fDl4ujq6Cwg6u7w6Pft5eKzLCDw7ufss/AgNDIuIMfw8/ftsyDy4CDss/btsy4g1rPt4DogMSA4OTAg4/DtLiCv5uDqLCCq4vDu7+AsILTg7e7qLCC65Ojt6OksIOT/6vO67O4sIO/u5ODw8+3u6iwg7+v/+OrgLCD57uTl7e3o6iwg6ui/4iwgv+bgLg=="
  },
  {
    "name": "bg as windows-1251",
    "encoding": "windows-1251",
    "text": "Мъжки кожени обувки, кафяви, размер 42. Удобни и здрави. Цена: 89,90 лв. Ръкавици, щастие, чорапи, шапка, ябълка, юни, дъждобран, кръстословица, мъж.",
    "base64": "zPrm6ugg6u7m5e3oIO7h8+Lq6Cwg6uD0/+LoLCDw4Ofs5fAgNDIuINPk7uHt6CDoIOfk8ODi6C4g1uXt4DogODksOTAg6+IuIND66uDi6PboLCD54PHy6OUsIPfu8ODv6Cwg+ODv6uAsIP/h+uvq4Cwg/u3oLCDk+ubk7uHw4O0sIOrw+vHy7vHr7uLo9uAsIOz65i4="
  },
  {
    "name": "sr as windows-1251",
    "encoding": "windows-1251",
    "text": "Мушке кожне ципеле, браон, величина 42. Удобне и издржљиве. Цена: 4.990 дин. Ђаци, љуљашка, њива, ћуфте, џемпер, шљива, јабука, хљеб, ђубре.",
    "base64": "zPP46uUg6u7m7eUg9ujv5evlLCDh8ODu7Swg4uXr6Pfo7eAgNDIuINPk7uHt5SDoIOjn5PDmmuji5S4g1uXt4DogNC45OTAg5OjtLiCA4PboLCCa85rg+OrgLCCc6OLgLCCe8/Ty5Swgn+Xs7+XwLCD4muji4CwgvODh8+rgLCD1muXhLCCQ8+Hw5S4="
  }
];

export function fixtureBytes(fixture: EncodingFixture): Uint8Array {
  return new Uint8Array(Buffer.from(fixture.base64, "base64"));
}
