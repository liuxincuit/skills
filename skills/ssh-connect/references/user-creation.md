# 远程 Linux 创建用户并配置 SSH 登录

本指南帮助你在远程 Linux 服务器上创建新用户，并配置该用户的 SSH 密钥免密登录。**你应该返回所有步骤，而不是只返回部分内容**

## 完整流程

```
1. 登录到远程服务器（初始状态）
2. 创建新用户
3. 配置 sudo 权限（可选）
4. 授予 Docker 操作权限
5. 本地生成 SSH 密钥
6. 复制公钥到远程服务器
7. 设置正确权限
8. 验证免密登录
9. 安全加固（可选但推荐）
```

---

## 步骤 1：登录到远程服务器（初始状态）

假设你已经有 root 或其他 sudo 用户的访问权限：

```bash
# 使用密码登录（初始配置阶段）
ssh root@server_ip
# 或
ssh existing_user@server_ip
```

---

## 步骤 2：在远程服务器上创建新用户

```bash
# 创建新用户（以 ubuntu 为例）
sudo adduser ubuntu
# 或
sudo useradd -m -s /bin/bash ubuntu

# 设置密码
sudo passwd ubuntu
```

---

## 步骤 3：配置 sudo 权限（可选）

```bash
# 方法1：添加到 sudo 组（推荐）
sudo usermod -aG sudo ubuntu

# 方法2：直接编辑 sudoers（更安全）
sudo visudo
# 添加行：ubuntu ALL=(ALL:ALL) ALL
```

---

## 步骤 3.5：授予 Docker 操作权限

如果服务器上安装了 Docker，需要将用户添加到 docker 组才能无 sudo 操作 Docker：

```bash
# 将用户添加到 docker 组
sudo usermod -aG docker ubuntu

# 验证 docker 组
groups ubuntu

# 退出登录后重新登录生效（或重启）
exit
ssh ubuntu@server_ip
docker ps  # 验证无需 sudo 即可操作
```

**说明**：
- `docker` 组成员可以无需 sudo 直接运行 Docker 容器
- 权限很大，生产环境需谨慎
- 如需更细粒度控制，需编辑 Docker daemon 配置

---

## 步骤 4：在本地生成 SSH 密钥

```bash
# 检查现有密钥
ls -la ~/.ssh/

# 生成新密钥（如果需要）
ssh-keygen -t ed25519 -C "your_email@example.com"
```

---

## 步骤 5：复制公钥到远程服务器

### 方法 1：ssh-copy-id（需要密码登录）

```bash
ssh-copy-id ubuntu@server_ip
```

### 方法 2：手动复制

```bash
# 查看公钥内容
cat ~/.ssh/id_ed25519.pub
# 或
cat ~/.ssh/id_rsa.pub
```

然后在远程服务器上执行：

```bash
# 切换到 ubuntu 用户
sudo su - ubuntu

# 创建 .ssh 目录
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# 添加公钥到 authorized_keys
echo "ssh-ed25519 AAAA...你的公钥内容... user@host" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# 退出 ubuntu 用户
exit
```

---

## 步骤 6：设置正确的文件权限

```bash
# 如果通过 root 用户配置
sudo chmod 700 "$HOME/.ssh"
sudo chmod 600 "$HOME/.ssh/authorized_keys"
sudo chown -R ubuntu:ubuntu "$HOME/.ssh"

# 如果是 ubuntu 用户自己设置
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

---

## 步骤 7：验证免密登录

```bash
# 从本地测试
ssh ubuntu@server_ip

# 使用别名（配置了 ~/.ssh/config 后）
ssh my-server
```

---

## 步骤 8：安全加固（可选但强烈推荐）

在远程服务器上编辑 SSH 配置：

```bash
sudo nano /etc/ssh/sshd_config
```

修改以下配置：

```
# 禁用 root 登录
PermitRootLogin no

# 禁用密码认证（强制密钥登录）
PasswordAuthentication no

# 允许公钥认证
PubkeyAuthentication yes
```

重启 SSH 服务：

```bash
sudo systemctl restart sshd
```

**警告**：确保公钥登录已配置成功后再禁用密码登录，否则可能无法登录！

---

## ~/.ssh/config 配置示例

在本地编辑 `~/.ssh/config` 文件：

```
# 服务器别名
Host my-server
    HostName server_ip
    User ubuntu
    Port 22
    IdentityFile ~/.ssh/id_ed25519
    ForwardAgent yes

# 另一台服务器
Host prod-server
    HostName example.com
    User ubuntu
    Port 2222
    IdentityFile ~/.ssh/id_ed25519
```

配置后可以直接使用别名连接：

```bash
ssh my-server
ssh prod-server
```

---

## 故障排查

### 连接被拒绝

```bash
# 检查端口是否正确
ssh -p 22 ubuntu@server_ip

# 检查服务器是否运行 SSH 服务
ssh root@server_ip "systemctl status sshd"
```

### 权限问题

```bash
# 确保远程服务器上权限正确
ssh ubuntu@server_ip "chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
```

### 密钥被拒绝

```bash
# 确认公钥已正确添加
ssh ubuntu@server_ip "cat ~/.ssh/authorized_keys"
```
