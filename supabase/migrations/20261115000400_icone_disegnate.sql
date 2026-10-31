-- Icone di cibo disegnate da Mastercook (lasagna, risotto, prosciutto crudo…).
--
-- L'icona scelta per una ricetta resta un testo nella colonna `emoji`: un'emoji vera, oppure `mc:<nome>` per un
-- disegno dell'app (per esempio «mc:lasagna»). Il nome è fatto di sole lettere minuscole e trattini bassi.

alter table public.icona_ricetta drop constraint icona_ricetta_emoji_check;
alter table public.icona_ricetta add constraint icona_ricetta_emoji_check check (
  (char_length(emoji) between 1 and 16 and emoji !~ '[[:alnum:][:space:]<>&]')
  or emoji ~ '^mc:[a-z_]{1,40}$'
);
