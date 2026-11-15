# Corpus degli scontrini

Dati di riferimento per misurare la lettura degli scontrini. Come funziona, cosa si misura e come aggiungere uno
scontrino vero: [docs/valutazione-scontrini.md](../../docs/valutazione-scontrini.md).

- `casi/<id>/verita.json`: la verità scritta a mano, con l'origine dichiarata.
- `casi/<id>/letture/`: testi già letti, congelati.
- `casi/<id>/foto.*`: foto vere; restano sul computer (ignorate da git, contengono dati personali).
- `base.json`: i numeri attuali del livello testo; `npm test` fallisce se peggiorano.
- `rapporti/`: rapporti del livello foto, uno per fase.
