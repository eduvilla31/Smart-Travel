"""One-off helper: turn the v0 English POI list into the bilingual seed dataset.

Run:  python3 scripts/build-seed.py   (writes src/data/basel-seed.json)
The seed is the offline fallback; live data comes from OpenStreetMap + Wikipedia.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
v0 = json.loads((ROOT / "scripts/basel-pois-v0.json").read_text())

# id: (interests, wikipedia titles, Spanish name, Spanish short text, extra flags)
EXTRA = {
    "rathaus": (["historic", "architecture", "local", "food"], ["en:Basel Town Hall", "de:Rathaus Basel"],
        "Ayuntamiento (Rathaus)",
        "Estás frente al Ayuntamiento de Basilea, el edificio rojo de la Marktplatz. Se construyó a principios del siglo XVI, poco después de que Basilea se uniera a la Confederación Suiza en 1501, y todavía acoge el gobierno y el parlamento del cantón.", {}),
    "fischmarkt": (["historic"], ["de:Fischmarktbrunnen (Basel)"],
        "Fuente del Fischmarkt",
        "Esta esbelta fuente gótica de la plaza Fischmarkt data de alrededor de 1390 y es una de las fuentes medievales más importantes de Suiza. Como indica su nombre, aquí se vendía pescado.", {}),
    "mittlere-bruecke": (["historic", "architecture", "local"], ["en:Mittlere Brücke", "de:Mittlere Brücke (Basel)"],
        "Puente Medio (Mittlere Brücke)",
        "Este es el Puente Medio, en el lugar de uno de los cruces más antiguos del Rin, construido por primera vez hacia 1225. Une la Grossbasel, el casco antiguo sobre la colina, con la Kleinbasel, en la otra orilla.", {}),
    "muenster": (["historic", "architecture"], ["en:Basel Minster", "de:Basler Münster"],
        "Catedral de Basilea (Münster)",
        "Bienvenido a la catedral de Basilea, el templo de arenisca roja con dos torres esbeltas que define la silueta de la ciudad. Gran parte de lo que ves se reconstruyó tras el gran terremoto de 1356, y aquí está enterrado Erasmo de Róterdam.", {}),
    "pfalz": (["parks", "local"], ["de:Pfalz (Basel)"],
        "Terraza del Pfalz",
        "Esta es la Pfalz, la terraza detrás de la catedral, muy por encima del Rin. Es uno de los mejores miradores de la ciudad, con vistas hacia la Kleinbasel y, en días claros, la Selva Negra.", {}),
    "muensterfaehre": (["local"], ["de:Münsterfähre"],
        "Transbordador de la catedral («Leu»)",
        "Bajando estas escaleras está el transbordador de la catedral, llamado Leu, el león. Los cuatro transbordadores del Rin en Basilea no tienen motor: la propia corriente del río los empuja de una orilla a otra.", {"stairs": True}),
    "spalentor": (["historic", "architecture"], ["en:Spalentor", "de:Spalentor"],
        "Puerta de Spalen (Spalentor)",
        "Esta es la Spalentor, la más impresionante de las tres puertas medievales que se conservan en Basilea. Se construyó hacia 1400 como parte de la muralla exterior, levantada tras el terremoto de 1356.", {}),
    "holbeinbrunnen": (["artists", "historic"], ["de:Holbeinbrunnen"],
        "Fuente de Holbein",
        "Esta fuente renacentista de la Spalenvorstadt se conoce como Fuente de Holbein. Su gaitero y sus campesinos bailando recuerdan diseños de los grandes artistas de la época, como Hans Holbein el Joven, que trabajó en Basilea.", {}),
    "petersplatz": (["historic", "parks", "local"], ["en:University of Basel", "de:Petersplatz (Basel)"],
        "Petersplatz y la Universidad",
        "Esta plaza arbolada es la Petersplatz, junto a los antiguos edificios de la universidad. La Universidad de Basilea, fundada en 1460, es la más antigua de Suiza.", {}),
    "tinguely-brunnen": (["artists", "streetart"], ["en:Tinguely Fountain", "de:Fasnachtsbrunnen"],
        "Fuente de Tinguely",
        "Frente al teatro está la Fuente de Tinguely, también llamada Fuente del Carnaval. La creó en 1977 el artista suizo Jean Tinguely, y sus diez máquinas negras salpican, giran y lanzan agua todo el día.", {}),
    "kunsthalle": (["artists"], ["en:Kunsthalle Basel"],
        "Kunsthalle Basel",
        "Este edificio es la Kunsthalle de Basilea, que muestra arte contemporáneo desde 1872. No tiene colección permanente: presenta exposiciones temporales, a menudo de artistas al inicio de su carrera internacional.", {}),
    "historisches-museum": (["historic"], ["en:Historical Museum Basel", "de:Historisches Museum Basel"],
        "Museo Histórico (Barfüsserkirche)",
        "La alta iglesia gótica de la Barfüsserplatz es la antigua iglesia franciscana, hoy sede del Museo Histórico de Basilea. A los franciscanos los llamaban los frailes descalzos, y de ahí viene el nombre de la plaza.", {}),
    "elisabethenkirche": (["historic", "architecture"], ["de:Elisabethenkirche (Basel)"],
        "Iglesia de Santa Isabel",
        "Esta iglesia neogótica, terminada en 1864, la pagaron el filántropo Christoph Merian y su esposa Margaretha. Fue una de las primeras grandes iglesias protestantes construidas en Suiza después de la Reforma.", {}),
    "kunstmuseum": (["artists", "architecture"], ["en:Kunstmuseum Basel"],
        "Kunstmuseum Basel",
        "Este es el Kunstmuseum de Basilea. Su colección comenzó en 1661, cuando la ciudad compró el Gabinete Amerbach, lo que lo convierte en una de las colecciones públicas de arte más antiguas del mundo.", {}),
    "picassoplatz": (["artists"], ["de:Picassoplatz"],
        "Picassoplatz",
        "Esta pequeña plaza lleva el nombre de Pablo Picasso gracias a una historia extraordinaria: en 1967, los habitantes de Basilea votaron en referéndum gastar dinero público en dos cuadros de Picasso para su museo, y el pintor, emocionado, regaló varias obras más a la ciudad.", {}),
    "cartoonmuseum": (["artists"], ["en:Cartoonmuseum Basel"],
        "Cartoonmuseum Basel",
        "En la elegante calle St. Alban-Vorstadt está el Cartoonmuseum, el único museo de Suiza dedicado por completo al dibujo narrativo: cómics, caricaturas y novelas gráficas.", {}),
    "hammering-man": (["artists", "streetart"], ["en:Hammering Man"],
        "Hammering Man (Aeschenplatz)",
        "Sobre la Aeschenplatz se alza el Hammering Man, una gigantesca silueta de acero del artista estadounidense Jonathan Borofsky. Su brazo motorizado balancea lentamente un martillo, día tras día.", {}),
    "oberer-rheinweg": (["local", "parks", "food"], [],
        "Paseo del Rin (Oberer Rheinweg)",
        "Este soleado paseo en la orilla de la Kleinbasel es el Oberer Rheinweg. En verano es el salón de la ciudad: gente sentada en los escalones, helados y baños en el Rin.", {}),
    "rheingasse": (["streetart", "local"], [],
        "Callejuelas de Kleinbasel (Rheingasse)",
        "Estás en la Rheingasse, una de las viejas callejuelas de la Kleinbasel. Este lado del río fue una ciudad aparte y conserva un ambiente más relajado y alternativo, con bares, tiendas pequeñas y muchas paredes pintadas.", {}),
    "kaserne": (["streetart", "local", "architecture"], ["de:Kaserne Basel"],
        "Kaserne Basel",
        "Este gran edificio junto al río es la Kaserne, un antiguo cuartel militar de la década de 1860. Hoy es uno de los principales centros culturales de Basilea, con conciertos, teatro y un patio lleno de vida.", {}),
    "matthaeus": (["streetart", "local"], [],
        "Murales del barrio Matthäus",
        "Ahora estás en el barrio de Matthäus, uno de los más diversos de Basilea. Fíjate en los grandes murales de las fachadas y en las piezas de colores de las calles laterales.", {}),
    "dreirosen": (["streetart"], ["de:Dreirosenbrücke"],
        "Bajo el puente Dreirosen",
        "Bajo el puente Dreirosen, los muros de hormigón junto al río se han convertido en uno de los lugares de grafiti y arte urbano más conocidos de Basilea.", {}),
    "holzpark": (["streetart", "local"], [],
        "Puerto de Klybeck (Holzpark)",
        "Bienvenido a la zona portuaria de Klybeck. Antiguos terrenos industriales junto al Rin se han llenado de bares temporales, huertos y artistas, y los muros, contenedores y silos están cubiertos de arte a gran escala.", {}),
    "museum-tinguely": (["artists", "architecture"], ["en:Museum Tinguely"],
        "Museo Tinguely",
        "Este edificio de arenisca rosada junto al Rin es el Museo Tinguely, diseñado por el arquitecto Mario Botta e inaugurado en 1996. Está dedicado a Jean Tinguely, el autor de la fuente junto al teatro.", {}),
}

NEW = [
    dict(id="markthalle", name="Markthalle Basel", nameEs="Markthalle Basel", lat=47.5502, lng=7.5866,
         interests=["food", "local", "architecture"], indoor=True, priority=2, wiki=["de:Markthalle Basel"],
         short="Under this great dome near the station is the Markthalle. It was built around 1929 as the city's wholesale market hall and today it is full of street-food stalls from around the world, a good stop for lunch or shelter from the rain.",
         shortEs="Bajo esta gran cúpula cerca de la estación está la Markthalle. Se construyó hacia 1929 como mercado mayorista de la ciudad y hoy está llena de puestos de comida de todo el mundo: buena parada para comer o refugiarse de la lluvia."),
    dict(id="botanischer-garten", name="University Botanical Garden", nameEs="Jardín Botánico de la Universidad", lat=47.5591, lng=7.5819,
         interests=["parks"], indoor=True, priority=1, wiki=["de:Botanischer Garten der Universität Basel"],
         short="Behind the old university buildings is the Botanical Garden of the University of Basel, one of the oldest botanical gardens in Switzerland. Its glasshouses make a warm, green shelter on a grey day.",
         shortEs="Detrás de los antiguos edificios universitarios está el Jardín Botánico de la Universidad de Basilea, uno de los más antiguos de Suiza. Sus invernaderos son un refugio cálido y verde en un día gris."),
    dict(id="solitude", name="Solitude Park", nameEs="Parque Solitude", lat=47.5600, lng=7.6103,
         interests=["parks", "local"], indoor=False, priority=1, wiki=[],
         short="This green riverside park, the Solitude, surrounds the Museum Tinguely. With its old trees and benches facing the Rhine, it is a calm spot to rest your feet.",
         shortEs="Este parque verde junto al río, la Solitude, rodea el Museo Tinguely. Con sus árboles centenarios y bancos frente al Rin, es un lugar tranquilo para descansar los pies."),
    dict(id="elisabethenanlage", name="Elisabethen Park", nameEs="Parque Elisabethen", lat=47.5501, lng=7.5898,
         interests=["parks", "historic"], indoor=False, priority=1, wiki=["de:Elisabethenanlage"],
         short="Between the station and the old town lies the Elisabethen park. Look for the Strasbourg Monument, a gift from the city of Strasbourg thanking Basel for helping its citizens during the war of 1870 to 1871.",
         shortEs="Entre la estación y el casco antiguo está el parque Elisabethen. Busca el Monumento de Estrasburgo, un regalo de esa ciudad para agradecer a Basilea la ayuda a sus habitantes durante la guerra de 1870 a 1871."),
    dict(id="st-alban-tor", name="St. Alban Gate", nameEs="Puerta de San Alban", lat=47.5528, lng=7.6044,
         interests=["historic", "architecture"], indoor=False, priority=2, wiki=["en:St. Alban Gate", "de:St. Alban-Tor"],
         short="This is the St. Alban Gate, another of Basel's three surviving medieval city gates. Surrounded by gardens and remains of the old wall, it once guarded the road east along the Rhine.",
         shortEs="Esta es la puerta de San Alban, otra de las tres puertas medievales que se conservan en Basilea. Rodeada de jardines y restos de la antigua muralla, protegía el camino hacia el este a lo largo del Rin."),
    dict(id="papiermuehle", name="Basel Paper Mill", nameEs="Molino de Papel de Basilea", lat=47.5547, lng=7.6018,
         interests=["historic", "artists"], indoor=True, priority=2, wiki=["en:Basel Paper Mill", "de:Basler Papiermühle"],
         short="In this medieval mill on the St. Alban canal, the Basel Paper Mill museum shows how paper was made and books were printed by hand. Basel was a major printing centre in the age of Erasmus.",
         shortEs="En este molino medieval junto al canal de San Alban, el museo del Molino de Papel muestra cómo se hacía el papel y se imprimían libros a mano. En la época de Erasmo, Basilea fue un gran centro de imprenta."),
    dict(id="roche-tower", name="Roche Towers", nameEs="Torres Roche", lat=47.5596, lng=7.6068,
         interests=["architecture"], indoor=False, priority=1, wiki=["en:Roche Tower"],
         short="Rising above Kleinbasel are the Roche towers, designed by the Basel architects Herzog and de Meuron for the pharmaceutical company Roche. When they were completed, each in turn became the tallest building in Switzerland.",
         shortEs="Sobre la Kleinbasel se alzan las torres Roche, diseñadas por los arquitectos basilienses Herzog y de Meuron para la farmacéutica Roche. Al terminarse, cada una fue a su vez el edificio más alto de Suiza."),
    dict(id="wettsteinbruecke", name="Wettstein Bridge", nameEs="Puente Wettstein", lat=47.5574, lng=7.5955,
         interests=["architecture", "historic"], indoor=False, priority=1, wiki=["de:Wettsteinbrücke"],
         short="The Wettstein Bridge links the Kunstmuseum side of the old town with Kleinbasel. It is named after Johann Rudolf Wettstein, the Basel mayor who in 1648 secured recognition of Swiss independence at the Peace of Westphalia.",
         shortEs="El puente Wettstein une el lado del Kunstmuseum con la Kleinbasel. Lleva el nombre de Johann Rudolf Wettstein, el alcalde de Basilea que en 1648 logró el reconocimiento de la independencia suiza en la Paz de Westfalia."),
    dict(id="messeplatz", name="Messeplatz & Exhibition Hall", nameEs="Messeplatz y Feria de Basilea", lat=47.5630, lng=7.6003,
         interests=["architecture", "artists"], indoor=False, priority=1, wiki=["en:Messe Basel"],
         short="This is Messeplatz, home of the Basel exhibition centre, where Art Basel takes place every June. Stand under the hall's huge round opening, the City Lounge, designed by Herzog and de Meuron, and look up.",
         shortEs="Esta es la Messeplatz, sede del recinto ferial de Basilea, donde cada junio se celebra Art Basel. Ponte bajo la enorme abertura circular del edificio, la City Lounge, diseñada por Herzog y de Meuron, y mira hacia arriba."),
]

pois = []
for p in v0["pois"]:
    interests, wiki, name_es, short_es, flags = EXTRA[p["id"]]
    pois.append({
        "id": p["id"], "lat": p["lat"], "lng": p["lng"],
        "name": {"en": p["name"], "es": name_es},
        "interests": interests, "indoor": p["indoor"], "priority": p["priority"],
        "wiki": wiki, **flags,
        "text": {"en": {"short": p["short"], "long": p["long"]}, "es": {"short": short_es}},
    })
for n in NEW:
    pois.append({
        "id": n["id"], "lat": n["lat"], "lng": n["lng"],
        "name": {"en": n["name"], "es": n["nameEs"]},
        "interests": n["interests"], "indoor": n["indoor"], "priority": n["priority"],
        "wiki": n["wiki"],
        "text": {"en": {"short": n["short"]}, "es": {"short": n["shortEs"]}},
    })

out = {
    "city": {"id": "basel", "name": "Basel", "center": [47.5596, 7.5886], "radiusKm": 15, "timezone": "Europe/Zurich"},
    "startPoints": [
        {"id": "marktplatz", "name": {"en": "Marktplatz (old town)", "es": "Marktplatz (casco antiguo)"}, "lat": 47.5577, "lng": 7.5875},
        {"id": "sbb", "name": {"en": "Basel SBB station", "es": "Estación Basel SBB"}, "lat": 47.5476, "lng": 7.5897},
        {"id": "claraplatz", "name": {"en": "Claraplatz (Kleinbasel)", "es": "Claraplatz (Kleinbasel)"}, "lat": 47.5622, "lng": 7.5937},
        {"id": "badbf", "name": {"en": "Badischer Bahnhof", "es": "Badischer Bahnhof"}, "lat": 47.5672, "lng": 7.6073},
    ],
    "pois": pois,
}
(ROOT / "src/data/basel-seed.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
print(len(pois), "POIs written")
