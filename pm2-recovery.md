# SOP Recovery PM2 Multi-User (submin + appreg)

## Tujuan
Menjamin proses PM2 kembali otomatis setelah reboot pada 2 user (`submin` dan `appreg`) dengan unit systemd yang stabil.

## Gejala yang ditangani
- `pm2-submin.service` / `pm2-appreg.service` gagal start.
- Error systemd: `Can't open PID file ... pm2.pid` dan `Failed with result 'protocol'`.

## Solusi yang dipakai
Gunakan unit systemd `Type=oneshot` + `pm2 resurrect` (tanpa bergantung pada PID file PM2).

## Langkah Eksekusi

### 1) Stop dan bersihkan service lama
```bash
sudo systemctl stop pm2-submin pm2-appreg || true
sudo systemctl disable pm2-submin pm2-appreg || true
```

### 2) Tulis unit `pm2-submin`
```bash
sudo tee /etc/systemd/system/pm2-submin.service >/dev/null <<'EOF'
[Unit]
Description=PM2 submin startup
After=network.target

[Service]
Type=oneshot
User=submin
Environment=PM2_HOME=/home/submin/.pm2
Environment=PATH=/usr/bin:/usr/local/bin:/bin
RemainAfterExit=yes
ExecStart=/usr/bin/pm2 resurrect
ExecReload=/usr/bin/pm2 reload all
ExecStop=/usr/bin/pm2 kill

[Install]
WantedBy=multi-user.target
EOF
```

### 3) Tulis unit `pm2-appreg`
```bash
sudo tee /etc/systemd/system/pm2-appreg.service >/dev/null <<'EOF'
[Unit]
Description=PM2 appreg startup
After=network.target

[Service]
Type=oneshot
User=appreg
Environment=PM2_HOME=/home/appreg/.pm2
Environment=PATH=/usr/bin:/usr/local/bin:/bin
RemainAfterExit=yes
ExecStart=/usr/bin/pm2 resurrect
ExecReload=/usr/bin/pm2 reload all
ExecStop=/usr/bin/pm2 kill

[Install]
WantedBy=multi-user.target
EOF
```

### 4) Reload, enable, dan start
```bash
sudo systemctl daemon-reload
sudo systemctl enable pm2-submin pm2-appreg
sudo systemctl start pm2-submin pm2-appreg
```

## Verifikasi

### 1) Status unit systemd
```bash
systemctl status pm2-submin --no-pager -l
systemctl status pm2-appreg --no-pager -l
```

Expected:
- Status `active (exited)` = normal untuk `Type=oneshot`.
- `ExecStart=/usr/bin/pm2 resurrect` keluar `status=0/SUCCESS`.

### 2) Cek proses PM2 per user
```bash
sudo -iu submin pm2 ls
sudo -iu appreg pm2 ls
```

### 3) Cek port service utama
```bash
sudo ss -ltnp | grep -E ":8000|:8001|:3100|:3101|:3102|:8080"
```

## Catatan Operasional
- Jalankan `pm2 save` setiap kali ada perubahan proses:

```bash
sudo -iu submin pm2 save
sudo -iu appreg pm2 save
```

- Hindari duplikasi proses backend pada port yang sama (contoh `appreg` hanya perlu 1 proses untuk dua domain yang sama-sama proxy ke `127.0.0.1:8000`).