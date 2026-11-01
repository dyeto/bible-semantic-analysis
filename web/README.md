# Explorer les Évangiles — prototype local

Site statique sans dépendance JavaScript externe, sans clé API ni appel à Mistral.
Les textes et scores sont exportés depuis les embeddings existants.

Depuis la racine du projet :

```sh
.venv/bin/python web/prepare_data.py
python3 -m http.server 8765 --bind 127.0.0.1 --directory web/dist
```

Ouvrir http://127.0.0.1:8765. Ne pas ouvrir index.html directement en file://.
Le serveur ne sert que `web/dist` (ni `.env`, ni les notebooks).

L'export est à refaire uniquement si les embeddings ou métadonnées changent.
Il conserve les six couples interlivres et les quatre comparaisons d’un livre avec
lui-même, les scores >= 0,80 et les textes. Les comparaisons internes incluent
les versets avec eux-mêmes (score 1) et les deux sens de chaque paire.
Chaque fichier gzip contient : nombre de paires (uint32), scores triés décroissants
(float32), indices aplatis (uint32), en little-endian. La largeur de la matrice
canonique est inscrite dans manifest.json. Le navigateur télécharge les couples
à la demande et filtre localement, sans recalculer les similarités.

Fonctionnalités : choix de deux livres, seuil 0,80–1, nuage avec zoom/déplacement,
arcs, lecture côte à côte, liste paginée de toutes les paires retenues,
recherche d'un verset par référence. La limite de liens dessinés est indépendante
du nombre total de paires. Une paire sélectionnée dans la liste est également
tracée si elle n'était pas dans cette limite.

Utiliser un navigateur récent prenant en charge DecompressionStream (gzip).
