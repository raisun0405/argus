# Fixtures

Saved copies of public data, so the unit tests run offline and always see the same input.

| Files | What | Source and licence |
|---|---|---|
| `1A28.pdb`, `1HSG.pdb`, `1HSG.cif`, `1M17.pdb`, `1STP.pdb`, `1TRZ.pdb`, `1TUP.pdb`, `2HYY.pdb`, `3HTB.pdb`, `3PTB.pdb`, `3PTB.cif`, `4HHB.pdb`, `4OBE.pdb` | Experimental structures | [RCSB PDB](https://www.rcsb.org) (wwPDB archive), CC0 1.0 |
| `arpeggio-*.json` | Interactions of a ligand with the protein, the reference for the interaction tests | [PDBe](https://www.ebi.ac.uk/pdbe/) graph API (Arpeggio), EMBL-EBI, CC BY 4.0 |
| `boltz-1hsg-output.cif`, `cofold-3PTB-server.pdb` | Boltz-2 predictions as the co-fold server returns them | Made with this app's co-fold function (Boltz-2 on NVIDIA NIM) |
| `pae/pae-*.json`, `pae/pae-P00533.json.gz`, `pae/pae-P04637.png` | Predicted aligned error of three AlphaFold models, and AlphaFold DB's own picture of one | [AlphaFold Protein Structure Database](https://alphafold.ebi.ac.uk) (Google DeepMind and EMBL-EBI), CC BY 4.0 |
