#!/usr/bin/env python3
"""Remove o fundo de uma imagem usando rembg (U2-Net).

Uso:
    python rembg_run.py <input.png> <output.png>

Saida sempre em PNG com canal alfa (fundo transparente).
"""
import sys
from rembg import remove


def main():
    if len(sys.argv) != 3:
        print("Uso: rembg_run.py <input> <output>", file=sys.stderr)
        sys.exit(2)
    inp, out = sys.argv[1], sys.argv[2]
    with open(inp, "rb") as f:
        data = f.read()
    result = remove(data)
    with open(out, "wb") as f:
        f.write(result)


if __name__ == "__main__":
    main()
