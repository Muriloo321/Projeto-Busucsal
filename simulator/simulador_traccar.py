#!/usr/bin/env python3
"""BusUCSAL — simulador local de rastreador (Traccar Client).

DEMONSTRAÇÃO LOCAL: não é um rastreador real. Percorre o trajeto cadastrado no backend
(GET /api/rota) e envia posições para POST /api/posicao, por padrão a cada 30 segundos.

Exemplos:
  python simulator/simulador_traccar.py                       # tempo real (30 s)
  python simulator/simulador_traccar.py --velocidade 15        # velocidade média em km/h
  python simulator/simulador_traccar.py --modo parado          # velocidade zero (testa "Parado")
  python simulator/simulador_traccar.py --modo sem-sinal --envios-antes-da-falha 3
  python simulator/simulador_traccar.py --formato osmand       # parâmetros como o Traccar Client
  python simulator/simulador_traccar.py --acelerado            # demonstração acelerada (2 s)
  python simulator/simulador_traccar.py --uma-vez              # envia só uma posição

O token vem de --token, da variável de ambiente DEVICE_TOKEN ou do arquivo .env do projeto.
Usa apenas a biblioteca padrão do Python 3.8+.
"""

import argparse
import json
import math
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PASSO_S = 30  # cada envio representa 30 s de deslocamento
KMH_PARA_NOS = 1 / 1.852


def ler_env(caminho):
    """Leitura simples de KEY=VALUE do .env (sem dependências)."""
    valores = {}
    if not caminho.exists():
        return valores
    for linha in caminho.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, valor = linha.split("=", 1)
        valores[chave.strip()] = valor.strip().strip('"').strip("'")
    return valores


def haversine(a, b):
    """Distância em metros entre (lon, lat) a e b."""
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


def extensao(coords):
    return sum(haversine(coords[i - 1], coords[i]) for i in range(1, len(coords)))


def interpolar(coords, metros):
    """Coordenada (lat, lon) a `metros` do início do trajeto."""
    acumulado = 0.0
    for i in range(1, len(coords)):
        d = haversine(coords[i - 1], coords[i])
        if acumulado + d >= metros:
            f = (metros - acumulado) / d if d > 0 else 0
            lon = coords[i - 1][0] + f * (coords[i][0] - coords[i - 1][0])
            lat = coords[i - 1][1] + f * (coords[i][1] - coords[i - 1][1])
            return lat, lon
        acumulado += d
    return coords[-1][1], coords[-1][0]


def requisitar(url, metodo="GET", corpo=None, cabecalhos=None, tempo=10):
    dados = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo, headers=cabecalhos or {})
    try:
        with urllib.request.urlopen(req, timeout=tempo) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as erro:
        try:
            conteudo = json.loads(erro.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            conteudo = None
        return erro.code, conteudo


def buscar_trajeto(base):
    status, dados = requisitar(f"{base}/api/rota")
    if status != 200 or not dados or not dados.get("rotas"):
        raise SystemExit(f"Não foi possível obter o trajeto em {base}/api/rota (HTTP {status}). O servidor está rodando e há rota ativa?")
    rotas = dados["rotas"]
    rota = next((r for r in rotas if r.get("sentido") == "ida"), rotas[0])
    return rota


def enviar(base, formato, token, dispositivo, lat, lon, velocidade, fonte):
    agora = datetime.now(timezone.utc)
    if formato == "osmand":
        # Parâmetros do protocolo OsmAnd (velocidade em nós, instante Unix). Token na URL,
        # pois o Traccar Client não envia cabeçalhos personalizados.
        parametros = urllib.parse.urlencode({
            "id": dispositivo, "lat": f"{lat:.6f}", "lon": f"{lon:.6f}",
            "speed": f"{velocidade * KMH_PARA_NOS:.2f}", "timestamp": int(agora.timestamp()),
            "accuracy": 8, "fonte": fonte, "token": token,
        })
        return requisitar(f"{base}/api/posicao?{parametros}", "POST", {}, {"Content-Type": "application/json"})
    corpo = {
        "dispositivo_id": dispositivo, "latitude": round(lat, 6), "longitude": round(lon, 6),
        "velocidade_kmh": round(velocidade, 1), "registrado_em": agora.isoformat().replace("+00:00", "Z"),
        "precisao_m": 8, "fonte": fonte,
    }
    return requisitar(f"{base}/api/posicao", "POST", corpo, {"Content-Type": "application/json", "X-Device-Token": token})


def main():
    try:
        sys.stdout.reconfigure(line_buffering=True)  # mostra cada envio imediatamente
    except AttributeError:
        pass
    env = {**ler_env(RAIZ / ".env"), **os.environ}
    dispositivo_padrao = (env.get("TRACKER_DEVICE_IDS") or "busucsal-01").split(",")[0].strip()

    p = argparse.ArgumentParser(description="Simulador local de rastreador do BusUCSAL (demonstração).")
    p.add_argument("--url", default=f"http://localhost:{env.get('PORT', '3000')}", help="endereço do backend")
    p.add_argument("--token", default=env.get("DEVICE_TOKEN"), help="token do dispositivo (DEVICE_TOKEN)")
    p.add_argument("--dispositivo", default=dispositivo_padrao, help="identificador do dispositivo")
    p.add_argument("--intervalo", type=float, default=30, help="segundos entre envios (padrão 30)")
    p.add_argument("--velocidade", type=float, default=18, help="velocidade média em km/h (padrão 18)")
    p.add_argument("--modo", choices=["normal", "parado", "sem-sinal"], default="normal")
    p.add_argument("--envios-antes-da-falha", type=int, default=3, help="no modo sem-sinal, quantos envios antes de parar")
    p.add_argument("--formato", choices=["json", "osmand"], default="json")
    p.add_argument("--acelerado", action="store_true", help="demonstração acelerada: envio a cada 2 s (fora das métricas)")
    p.add_argument("--inicio-m", type=float, default=0, help="posição inicial no trajeto, em metros")
    p.add_argument("--voltas", type=int, default=0, help="encerrar após N voltas (0 = sem limite)")
    p.add_argument("--uma-vez", action="store_true", help="enviar uma única posição e sair")
    a = p.parse_args()

    if not a.token:
        raise SystemExit("Informe o token: --token, variável DEVICE_TOKEN ou arquivo .env.")
    intervalo = 2 if a.acelerado else a.intervalo
    fonte = "simulador_acelerado" if a.acelerado else "simulador"

    rota = buscar_trajeto(a.url.rstrip("/"))
    coords = rota["coordenadas"]
    total = extensao(coords)
    print(f"Simulando {rota['nome']} ({total:.0f} m) · envio a cada {intervalo:g} s · modo {a.modo} · formato {a.formato}")
    if a.acelerado:
        print("ATENÇÃO: demonstração acelerada. Cada envio avança 30 s de trajeto; as previsões não refletem o tempo real.")

    progresso = max(0.0, min(a.inicio_m, total))
    envios = 0
    voltas = 0
    try:
        while True:
            if a.modo == "parado":
                velocidade = 0.0
            else:
                velocidade = max(3.0, a.velocidade * random.uniform(0.75, 1.25))
            if a.modo == "sem-sinal" and envios >= a.envios_antes_da_falha:
                print(f"[{datetime.now():%H:%M:%S}] sem sinal — nenhuma posição enviada (o status vira 'Sem dados' após 3 min)")
            else:
                lat, lon = interpolar(coords, progresso)
                status, resposta = enviar(a.url.rstrip("/"), a.formato, a.token, a.dispositivo, lat, lon, velocidade, fonte)
                envios += 1
                if status == 200 and resposta:
                    extra = f"rota {resposta.get('rota_id')} · {resposta.get('progresso_m')} m" if resposta.get("rota_id") else "fora do trajeto"
                    print(f"[{datetime.now():%H:%M:%S}] HTTP {status} · {lat:.5f}, {lon:.5f} · {velocidade:.1f} km/h · {extra}")
                else:
                    print(f"[{datetime.now():%H:%M:%S}] HTTP {status} · {json.dumps(resposta, ensure_ascii=False)}")
                    if status in (401, 403):
                        raise SystemExit("Token ou dispositivo recusado. Confira DEVICE_TOKEN e TRACKER_DEVICE_IDS.")
            if a.uma_vez:
                break
            if a.modo != "parado":
                progresso += velocidade / 3.6 * PASSO_S
                if progresso >= total:
                    progresso = 0.0
                    voltas += 1
                    print(f"— volta {voltas} concluída —")
                    if a.voltas and voltas >= a.voltas:
                        break
            time.sleep(intervalo)
    except KeyboardInterrupt:
        print("\nSimulação interrompida.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
