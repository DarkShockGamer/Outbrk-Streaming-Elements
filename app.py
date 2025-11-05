from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
import requests
import os

app = Flask(__name__, static_folder='assets')  # 'assets' is the folder with your HTML files
CORS(app)  # Enable CORS for all routes and origins

OUTBRK_TOKEN = "8bf12bdc"

@app.route('/stats')
def get_stats():
    url = f"https://api.outbrkgame.com/api/stats?token={OUTBRK_TOKEN}"
    try:
        response = requests.get(url)
        response.raise_for_status()
        return jsonify(response.json())
    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 500

# Serve HTML overlay files from the assets directory
@app.route('/assets/<path:filename>')
def serve_overlay(filename):
    return send_from_directory(app.static_folder, filename)

if __name__ == '__main__':
    app.run(debug=True)